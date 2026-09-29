"""
I-Parol segmentation backend.

Single endpoint: POST /segment
Input:  a digital line-art drawing (PNG/JPG), uploaded as multipart/form-data
Output: JSON list of enclosed zones as polygons, ready for the frontend
        to render as tappable regions.

No ML/training anywhere in this file — pure image processing
(threshold -> skeleton endpoint bridging -> connected components ->
contour extraction), matching the locked decision in the project
handoff doc.
"""

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import io
import shutil
import subprocess
import cv2
import librosa
import numpy as np

app = FastAPI(title="I-Parol Segmentation API")

# Wide open for now (class project on a free tier) — tighten to the
# real frontend origin(s) once the Vercel/Netlify URL is known.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST"],
    allow_headers=["*"],
)

# ---- tunables -------------------------------------------------------
UPSCALE = 3            # process at 3x resolution for cleaner contours,
                        # then report coordinates back in original space

# Fixed, SMALL closing kernel — only for anti-aliasing/JPEG noise right
# at the edge of a line, not for bridging real gaps. Real gaps (acute-
# angle line tips that rasterize with a broken sub-pixel-thin tip) are
# now handled by targeted skeleton-endpoint bridging below, not by a
# blanket kernel. A blanket kernel big enough to seal those gaps was
# also big enough to eat genuinely thin, separate zone details (see the
# git history / handoff doc for the 384 -> 323 zone regression that
# caused). This fixed small kernel never needs to scale with resolution
# because anti-aliasing artifacts are a few pixels regardless of the
# source drawing's size.
ANTIALIAS_KERNEL = 3

# ---- skeleton endpoint bridging --------------------------------------
# The problem this solves: a line-art drawing that LOOKS fully closed can
# still rasterize with a broken gap, almost always where two strokes meet
# at a sharp/acute angle (the tip thins out below 1px and anti-aliasing
# turns it gray instead of solid black). A blanket morphological kernel
# big enough to bridge that gap is also big enough to fuse together two
# genuinely separate zones that just happen to be thin and close together
# (e.g. two parallel detail lines). Bridging every gap the same way a
# human tracing the drawing would — by finding where a line just stops
# and connecting it to the nearest other stopped line-end nearby — fixes
# real breaks without touching real thin zones, since a real thin zone's
# outline has no broken endpoints to begin with.
#
# How: skeletonize the wall mask down to a 1px-wide centerline
# (cv2.ximgproc.thinning), find every point on that skeleton with exactly
# one neighboring skeleton pixel (a dead end), then pair up dead ends that
# are close to each other and draw a short real line between them on the
# actual wall mask (not the skeleton) to physically seal that specific gap.
# Dead ends with no other dead end nearby are left alone — those are
# either genuine open decorative line ends or too far apart to safely
# assume they're the same broken line, so bridging them would risk
# joining two zones that were never meant to connect.
BRIDGE_MAX_DIST_BASE = 40     # bridge distance at BRIDGE_BASE_DIM, scaled
                               # for higher-resolution uploads, same
                               # reasoning as the old kernel scaling: a gap
                               # that's "small" in absolute pixels on a
                               # high-res export is proportionally the same
                               # size as a smaller gap on a low-res one.
                               #
                               # IMPORTANT — this number needs real-world
                               # calibration, and 40 is a starting point,
                               # not a measured final value: thinning pulls
                               # a broken line's endpoint back from the
                               # actual gap by roughly half the wall's own
                               # thickness before you ever measure the
                               # distance between two endpoints, so the
                               # true endpoint-to-endpoint distance for a
                               # real, tiny 1-2px acute-angle gap is bigger
                               # than the gap itself — confirmed in testing
                               # here: a 2px real gap on a 6px-thick wall
                               # measured 38px apart at this working
                               # resolution, not ~6px. Validate this number
                               # against your actual dense test drawing
                               # (the same one used to confirm the old
                               # kernel=13 fix): if a known real gap still
                               # leaks, raise this; if two genuinely
                               # separate nearby thin zones start fusing
                               # into one, lower it.
BRIDGE_BASE_DIM = 1440         # the upscaled working resolution (native
                                # 480px x UPSCALE 3) this base distance was
                                # tuned against.
BRIDGE_MIN_DIST = 10
BRIDGE_MAX_DIST_CAP = 150
BRIDGE_LINE_THICKNESS = 3      # matches ANTIALIAS_KERNEL so a bridged gap
                                # looks like the same wall thickness as the
                                # rest of the drawing, not a thin scar.
BRIDGE_EDGE_MARGIN = 4         # px margin from the image border, in
                                # skeleton (upscaled) space; dead ends this
                                # close to the border are the artwork
                                # running off the edge, not a real gap, so
                                # they're excluded from bridging.

# Endpoint-to-endpoint bridging alone doesn't catch every real gap: some
# breaks are a line stub ending near the FLAT SIDE of a neighboring wall
# (a T-shaped gap), not near another dead end, so there's no second
# endpoint to pair it with. Confirmed on the real reference drawing
# (escuro_test.png, 2048px native): endpoint bridging alone plateaus at
# 264/265 known-correct zones no matter how far the pairing distance is
# raised, because a handful of these T-shaped gaps are structurally
# invisible to endpoint-pairing. A small SECOND closing pass after
# bridging catches those remaining leaks — small because bridging already
# closed the majority of gaps, so this pass only needs to nudge the few
# stragglers shut, unlike the old single blanket kernel that had to do
# all the work alone (and paid for it by eating fine detail). Scaled the
# same way as the old kernel, just with a much lower ceiling.
EXTRA_CLOSE_BASE = 3           # value at BRIDGE_BASE_DIM (1440); tuned so
                                # this stays at its minimum (basically a
                                # no-op) on lower-resolution uploads and
                                # only grows on higher-resolution ones,
                                # exactly like the retired blanket kernel
                                # used to, but capped far lower.
EXTRA_CLOSE_MIN = 3
EXTRA_CLOSE_MAX = 11           # confirmed against escuro_test.png: this
                                # combination (bridge cap 150 + this pass
                                # scaling up to 11 at that image's working
                                # resolution) reproduces exactly 265 zones,
                                # the previously-confirmed-correct count
                                # for that drawing. 13 overshoots to 271-273
                                # (starts re-fusing things), 9 undershoots
                                # to 261 (leaves real leaks). Re-validate
                                # this ceiling if a different dense
                                # reference drawing gives a different
                                # answer — 265 is this one drawing's known
                                # ground truth, not a universal constant.

MIN_ZONE_AREA_PX = 15   # at native resolution; filters out stray specks
BACKGROUND_AREA_FRACTION = 0.30  # a component this big touching all 4
                                   # edges is treated as "outside the art",
                                   # not a real zone
SIMPLIFY_EPSILON_FRAC = 0.0025    # gentler than typical approxPolyDP use;
                                   # preserves curves instead of faceting them
# NOTE on thresholding: adaptive (per-local-neighborhood) thresholding was
# tried here and reverted. It works fine on THIN lines, but on a drawing
# exported at higher resolution — where the same artwork's lines are
# proportionally much thicker in absolute pixels — a local neighborhood
# smaller than the line's thickness has no internal contrast to compare
# against, so adaptive thresholding "hollows out" the middle of thick lines,
# misclassifying it as open space. That silently punches a hole straight
# through walls and merges zones on either side of them. Confirmed: a real
# 2048px-native drawing with ~12px-thick lines dropped from ~240 correctly
# detected zones to 37 under adaptive thresholding, purely from this effect.
# Global Otsu thresholding (below) still automatically finds the right
# dark/light cutoff per image — it just does it once for the whole image
# instead of per tiny neighborhood, which avoids the hollowing-out failure
# regardless of how thick a line is. Tested equivalent zone counts on the
# original thin-line test image (384 vs 386 — no regression) and correct on
# the thick-line case where adaptive failed. Don't reintroduce adaptive
# thresholding unless photo uploads (with real lighting gradients) become an
# actual supported feature — pure digital line art doesn't need it and it's
# actively worse for it.
# ----------------------------------------------------------------------


def _bridge_gaps(walls: np.ndarray) -> np.ndarray:
    """Find broken line-ends via skeleton endpoints and seal only those
    specific gaps, directly on the wall mask. Returns a new wall mask;
    does not mutate the input.
    """
    walls = walls.copy()
    h, w = walls.shape

    skeleton = cv2.ximgproc.thinning(walls)

    # A skeleton pixel is a "dead end" if exactly one of its 8 neighbors
    # is also a skeleton pixel. Encode the center pixel with weight 10 so
    # (center=1)*10 + (neighbor sum) is uniquely 11 only when the center
    # is lit AND has exactly one lit neighbor.
    binary_sk = (skeleton > 0).astype(np.uint8)
    neighbor_kernel = np.array([[1, 1, 1], [1, 10, 1], [1, 1, 1]], dtype=np.uint8)
    neighbor_count = cv2.filter2D(
        binary_sk, -1, neighbor_kernel, borderType=cv2.BORDER_CONSTANT
    )
    endpoint_mask = (binary_sk == 1) & (neighbor_count == 11)
    ys, xs = np.where(endpoint_mask)
    if len(xs) < 2:
        return walls  # nothing to bridge

    endpoints = np.stack([xs, ys], axis=1).astype(float)

    # Drop endpoints that are just the artwork running off the image
    # border — not a real gap.
    interior = (
        (endpoints[:, 0] > BRIDGE_EDGE_MARGIN)
        & (endpoints[:, 0] < w - BRIDGE_EDGE_MARGIN)
        & (endpoints[:, 1] > BRIDGE_EDGE_MARGIN)
        & (endpoints[:, 1] < h - BRIDGE_EDGE_MARGIN)
    )
    endpoints = endpoints[interior]
    if len(endpoints) < 2:
        return walls

    bridge_max_dist = round(
        BRIDGE_MAX_DIST_BASE * (max(h, w) / BRIDGE_BASE_DIM)
    )
    bridge_max_dist = max(BRIDGE_MIN_DIST, min(bridge_max_dist, BRIDGE_MAX_DIST_CAP))

    # Greedy nearest-pair matching: repeatedly bridge the closest still-
    # unused pair of endpoints, skipping any pair further apart than
    # bridge_max_dist. This mirrors what a human eye does when spotting a
    # gap — connect each broken end to whichever other broken end is
    # actually close by, not to every other dead end in the drawing.
    dists = np.linalg.norm(endpoints[:, None, :] - endpoints[None, :, :], axis=2)
    np.fill_diagonal(dists, np.inf)
    n = len(endpoints)
    used = np.zeros(n, dtype=bool)
    flat_order = np.dstack(np.unravel_index(np.argsort(dists, axis=None), dists.shape))[0]

    for i, j in flat_order:
        if used[i] or used[j]:
            continue
        if dists[i, j] > bridge_max_dist:
            break  # sorted ascending — everything after this is farther too
        p1 = tuple(endpoints[i].astype(int))
        p2 = tuple(endpoints[j].astype(int))
        cv2.line(walls, p1, p2, 255, thickness=BRIDGE_LINE_THICKNESS)
        used[i] = True
        used[j] = True

    # Small supplementary closing pass for the T-shaped gaps endpoint
    # pairing structurally can't reach (see EXTRA_CLOSE_BASE note above).
    extra_k = round(EXTRA_CLOSE_BASE * (max(h, w) / BRIDGE_BASE_DIM))
    extra_k = max(EXTRA_CLOSE_MIN, min(extra_k, EXTRA_CLOSE_MAX))
    if extra_k % 2 == 0:
        extra_k += 1
    extra_kernel = np.ones((extra_k, extra_k), np.uint8)
    walls = cv2.morphologyEx(walls, cv2.MORPH_CLOSE, extra_kernel, iterations=1)

    return walls


def segment_image(image_bytes: bytes) -> dict:
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
    if img is None:
        raise ValueError("Could not decode image — is it a valid PNG/JPG?")

    # Composite alpha onto white so transparent backgrounds don't get
    # mistaken for "wall" pixels.
    if img.ndim == 3 and img.shape[2] == 4:
        bgr = img[:, :, :3].astype(float)
        alpha = img[:, :, 3].astype(float) / 255.0
        white = np.ones_like(bgr) * 255
        bgr = bgr * alpha[..., None] + white * (1 - alpha[..., None])
        img = bgr.astype(np.uint8)
    elif img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    else:
        img = img[:, :, :3]

    native_h, native_w = img.shape[:2]

    img_big = cv2.resize(
        img, None, fx=UPSCALE, fy=UPSCALE, interpolation=cv2.INTER_CUBIC
    )
    gray = cv2.cvtColor(img_big, cv2.COLOR_BGR2GRAY)

    # Global Otsu thresholding: automatically finds the right dark/light
    # cutoff for this image (not a fixed hardcoded number), but applies it
    # once for the whole image rather than per local neighborhood — see the
    # tunables note above for why local/adaptive thresholding actively
    # breaks on thick lines.
    _, binary = cv2.threshold(
        gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
    )

    # Small fixed closing for anti-aliasing/compression noise only.
    kernel = np.ones((ANTIALIAS_KERNEL, ANTIALIAS_KERNEL), np.uint8)
    walls = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=1)

    # Targeted gap sealing: bridge only genuine broken line-ends, leaving
    # real thin/fine detail (which has no broken endpoints) untouched.
    walls = _bridge_gaps(walls)

    zone_mask = cv2.bitwise_not(walls)

    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(
        zone_mask, connectivity=4
    )

    h, w = gray.shape
    min_area_scaled = MIN_ZONE_AREA_PX * (UPSCALE * UPSCALE)

    zones = []
    for i in range(1, num_labels):
        area = stats[i, cv2.CC_STAT_AREA]
        x, y, cw, ch = (
            stats[i, cv2.CC_STAT_LEFT],
            stats[i, cv2.CC_STAT_TOP],
            stats[i, cv2.CC_STAT_WIDTH],
            stats[i, cv2.CC_STAT_HEIGHT],
        )

        touches_edges = x <= 0 and y <= 0 and x + cw >= w - 1 and y + ch >= h - 1
        if touches_edges and area > (w * h * BACKGROUND_AREA_FRACTION):
            continue  # this is "outside the artwork", not a zone
        if area < min_area_scaled:
            continue  # noise speck

        mask = (labels == i).astype(np.uint8) * 255
        contours, _ = cv2.findContours(
            mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_TC89_L1
        )
        if not contours:
            continue
        c = max(contours, key=cv2.contourArea)

        epsilon = SIMPLIFY_EPSILON_FRAC * cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, epsilon, True)
        pts = (approx.reshape(-1, 2) / UPSCALE).round(1).tolist()
        if len(pts) < 3:
            continue

        zones.append(
            {
                "id": f"z{i}",
                "points": pts,
                "cx": round(float(centroids[i][0] / UPSCALE), 1),
                "cy": round(float(centroids[i][1] / UPSCALE), 1),
                "area": int(area / (UPSCALE * UPSCALE)),
            }
        )

    return {"width": native_w, "height": native_h, "zone_count": len(zones), "zones": zones}


@app.post("/segment")
async def segment(file: UploadFile = File(...)):
    if file.content_type != "image/png":
        raise HTTPException(
            status_code=400,
            detail=(
                f"Expected a PNG line-art drawing, got {file.content_type}. "
                "JPEG isn't accepted here — its compression blurs and adds "
                "noise around thin lines, which breaks or merges zones. "
                "Export/save the drawing as PNG instead."
            ),
        )

    image_bytes = await file.read()
    MAX_BYTES = 15 * 1024 * 1024
    if len(image_bytes) > MAX_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 15MB)")

    try:
        result = segment_image(image_bytes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if result["zone_count"] == 0:
        raise HTTPException(
            status_code=422,
            detail=(
                "No enclosed zones were found. Make sure the drawing has "
                "clean, fully closed black outlines with no gaps."
            ),
        )

    return JSONResponse(result)


# ---- audio analysis tunables -----------------------------------------
# No ML/training here either — BPM/beat detection and structural
# segmentation both come straight from librosa's built-in signal-
# processing algorithms (onset strength + dynamic programming for beats,
# recurrence-based clustering for sections). Nothing is trained, matching
# the same locked decision that governs the segmentation endpoint above.

ENERGY_HOP_LENGTH = 512   # samples between energy measurements; librosa's
                          # own default, gives ~23ms resolution at 22.05kHz
                          # sample rate (fine enough for pacing, coarse
                          # enough to keep the JSON response small before
                          # bucketing below)

ENERGY_BUCKET_SEC = 0.5   # the raw RMS energy curve has one value every
                          # ~23ms, which for a 3-minute song is thousands
                          # of points — far more resolution than pacing
                          # needs (pacing works in beats/bars, not
                          # milliseconds). Averaging into 0.5s buckets
                          # keeps the response small while still tracking
                          # every real rise/fall in the song's intensity.

MIN_SECTION_SECONDS = 8    # a "section" shorter than this is almost
                           # certainly a false split (e.g. a single fill
                           # or a fast fade), not a real structural
                           # section (verse/chorus/etc) a student would
                           # want to design a distinct on/off pattern for
TARGET_SECTION_SECONDS = 20  # rough real-world length of a verse or
                              # chorus; used only to pick how many
                              # sections to look for, not as a hard rule
MIN_SECTIONS = 2
MAX_SECTIONS = 12   # a section count higher than this stops being
                     # meaningfully different from just working beat-by-
                     # beat, and adds more taps than a student wants to
                     # do in the (not-yet-built) sequence-tapping UI

BEAT_TIGHTNESS = 40      # librosa's default is 100, which strongly prefers
                         # ONE steady tempo and will smooth a tempo change
                         # away (or lock onto the wrong pulse after it).
                         # Lower values let the beat tracker follow tempo
                         # shifts; too low and it gets jittery on steady
                         # songs. 40 is a middle ground — tune per batch
                         # songs if beats look off after a tempo change.
MIN_BPM = 70             # Beat trackers often lock onto double (eighth-note)
MAX_BPM = 140            # or half tempo. The song's overall tempo is folded
                         # into [MIN_BPM, MAX_BPM) by halving/doubling the
                         # WHOLE song by one factor, so relative tempo
                         # changes are preserved. Trade-off: a song that
                         # genuinely sits outside this range gets shifted
                         # (e.g. a true 150 BPM song reads as 75) — that
                         # is why the response reports what was applied.
TEMPO_WINDOW_BEATS = 8   # local BPM is the median of this many neighboring
                         # beat gaps — big enough to ignore a single
                         # misplaced beat, small enough to notice a real
                         # tempo change within a couple of bars
# ------------------------------------------------------------------------


def _fix_octave(beat_times: list):
    """Fold the song's overall tempo into [MIN_BPM, MAX_BPM).

    Returns (beat_times, factor). factor is 0.5 per halving / 2 per
    doubling applied (e.g. 0.5 = beats were thinned to every other one).
    Halving keeps every other beat; doubling inserts a beat midway
    between each pair.
    """
    factor = 1.0
    if len(beat_times) < 4:
        return beat_times, factor

    median_bpm = 60.0 / float(np.median(np.diff(beat_times)))

    while median_bpm >= MAX_BPM and len(beat_times) >= 4:
        beat_times = beat_times[::2]
        median_bpm /= 2
        factor /= 2

    while median_bpm < MIN_BPM:
        doubled = []
        for a, b in zip(beat_times, beat_times[1:]):
            doubled += [a, round((a + b) / 2, 3)]
        doubled.append(beat_times[-1])
        beat_times = doubled
        median_bpm *= 2
        factor *= 2

    return beat_times, factor


def _local_bpm(beat_times: list) -> list:
    """BPM around each beat, from the median of nearby beat gaps.
    Returns one {time, bpm} per beat (the last beat has no following gap,
    so it reuses the previous value)."""
    if len(beat_times) < 2:
        return []
    gaps = np.diff(np.array(beat_times))
    half = TEMPO_WINDOW_BEATS // 2
    curve = []
    for i in range(len(gaps)):
        window = gaps[max(0, i - half): i + half + 1]
        gap = float(np.median(window))
        curve.append({"time": beat_times[i], "bpm": round(60.0 / gap, 1) if gap > 0 else 0.0})
    curve.append({"time": beat_times[-1], "bpm": curve[-1]["bpm"]})
    return curve


def _decode_via_ffmpeg(audio_bytes: bytes):
    """Fallback decoder: pipe the raw MP3 bytes straight into ffmpeg and
    read back decoded WAV bytes, entirely in memory (stdin/stdout pipes,
    no temp file). This sidesteps a real flakiness in audioread's own
    temp-file handling on Windows, where a freshly-written file can
    briefly be reported as "does not exist" to the subprocess it shells
    out to (antivirus/file-lock timing), even though the file is right
    there. Talking to ffmpeg directly avoids that path entirely.
    """
    ffmpeg_bin = shutil.which("ffmpeg")
    if not ffmpeg_bin:
        raise ValueError(
            "ffmpeg is not installed or not on PATH — required to decode "
            "this MP3 (soundfile alone couldn't read it)."
        )

    try:
        result = subprocess.run(
            [
                ffmpeg_bin,
                "-hide_banner",
                "-loglevel", "error",
                "-i", "pipe:0",       # read input from stdin
                "-f", "wav",
                "-ar", "44100",
                "-ac", "1",           # mono, matches librosa's mono=True elsewhere
                "pipe:1",             # write output to stdout
            ],
            input=audio_bytes,
            capture_output=True,
            timeout=120,
            check=True,
        )
    except subprocess.CalledProcessError as e:
        raise ValueError(
            "ffmpeg could not decode this file — it may be corrupted or "
            f"not actually an MP3. ffmpeg said: {e.stderr.decode(errors='ignore').strip()}"
        )
    except subprocess.TimeoutExpired:
        raise ValueError("ffmpeg took too long decoding this file.")

    return librosa.load(io.BytesIO(result.stdout), sr=None, mono=True)


def _load_audio(audio_bytes: bytes):
    """Decode uploaded audio to a waveform + sample rate.

    librosa.load() reads via `soundfile` first, which is fast but picky —
    some MP3 encoders, VBR files, or embedded ID3v2 album-art tags make it
    fail with a bare "Format not recognised" even on a perfectly valid
    MP3. When that happens, fall back to calling ffmpeg directly (see
    _decode_via_ffmpeg above), which is far more tolerant of real-world
    files than soundfile's own MP3 parsing.
    """
    try:
        return librosa.load(io.BytesIO(audio_bytes), sr=None, mono=True)
    except Exception as first_error:
        try:
            return _decode_via_ffmpeg(audio_bytes)
        except ValueError as fallback_error:
            raise ValueError(
                f"soundfile couldn't read this MP3 ({first_error}), and "
                f"the ffmpeg fallback also failed: {fallback_error}"
            )


def analyze_audio(audio_bytes: bytes) -> dict:
    """Analyze an uploaded song: BPM, beat timestamps, an energy curve,
    and a set of structural section boundaries with each section's
    average energy.

    Pure function like segment_image() above — no FastAPI code in here,
    just librosa/numpy. Returns a plain dict, ready to hand to
    JSONResponse.
    """
    try:
        y, sr = _load_audio(audio_bytes)
    except ValueError:
        raise
    except Exception as e:
        raise ValueError(
            "Could not decode audio — is this a valid MP3? "
            f"(underlying error: {e})"
        )

    duration = float(librosa.get_duration(y=y, sr=sr))
    if duration < MIN_SECTION_SECONDS:
        raise ValueError(
            f"Audio is only {duration:.1f}s long — too short to analyze "
            "meaningfully."
        )

    # ---- BPM + beat timestamps ----
    # beat_track returns tempo as a 1-element array in newer librosa
    # versions and a bare float in older ones — float(...) handles both.
    tempo, beat_frames = librosa.beat.beat_track(
        y=y, sr=sr, tightness=BEAT_TIGHTNESS
    )
    bpm = round(float(np.atleast_1d(tempo)[0]), 1)
    beat_times = librosa.frames_to_time(beat_frames, sr=sr).round(3).tolist()
    beat_times, tempo_factor = _fix_octave(beat_times)
    bpm = round(bpm * tempo_factor, 1)
    tempo_curve = _local_bpm(beat_times)

    # ---- energy curve (RMS loudness over time) ----
    rms = librosa.feature.rms(y=y, hop_length=ENERGY_HOP_LENGTH)[0]
    rms_times = librosa.frames_to_time(
        np.arange(len(rms)), sr=sr, hop_length=ENERGY_HOP_LENGTH
    )
    rms_max = float(rms.max()) if rms.max() > 0 else 1.0
    energy_norm = rms / rms_max  # 0-1, relative to this song's own loudest moment

    # Downsample into fixed-length time buckets (see ENERGY_BUCKET_SEC
    # note above) rather than shipping every raw frame to the frontend.
    bucket_count = max(1, int(np.ceil(duration / ENERGY_BUCKET_SEC)))
    energy_curve = []
    for b in range(bucket_count):
        t0, t1 = b * ENERGY_BUCKET_SEC, (b + 1) * ENERGY_BUCKET_SEC
        in_bucket = (rms_times >= t0) & (rms_times < t1)
        if np.any(in_bucket):
            e = float(energy_norm[in_bucket].mean())
        else:
            e = energy_curve[-1]["energy"] if energy_curve else 0.0
        energy_curve.append({"time": round(t0, 2), "energy": round(e, 3)})

    # ---- structural sections ----
    # Standard librosa recipe: build a feature stack (timbre via MFCC +
    # harmony via chroma), then librosa.segment.agglomerative clusters
    # frames into `k` contiguous segments by where those features change
    # the most — this is what actually finds verse/chorus/bridge-style
    # boundaries, not just a fixed-length chop of the song.
    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13, hop_length=ENERGY_HOP_LENGTH)
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=ENERGY_HOP_LENGTH)
    n_frames = min(mfcc.shape[1], chroma.shape[1])
    features = np.vstack([mfcc[:, :n_frames], chroma[:, :n_frames]])

    # Pick how many sections to look for based on song length, not a
    # fixed number — a 40s clip and a 4-minute song shouldn't be forced
    # into the same section count.
    target_k = round(duration / TARGET_SECTION_SECONDS)
    k = max(MIN_SECTIONS, min(target_k, MAX_SECTIONS))

    boundary_frames = librosa.segment.agglomerative(features, k)
    boundary_times = librosa.frames_to_time(
        boundary_frames, sr=sr, hop_length=ENERGY_HOP_LENGTH
    )
    boundary_times = sorted(set([0.0] + boundary_times.round(3).tolist() + [duration]))

    # Merge any section shorter than MIN_SECTION_SECONDS into its
    # neighbor rather than leaving a sliver section a student can't
    # meaningfully design an on/off pattern for.
    merged = [boundary_times[0]]
    for t in boundary_times[1:]:
        if t - merged[-1] < MIN_SECTION_SECONDS and t != duration:
            continue  # drop this boundary, extending the current section
        merged.append(t)
    if len(merged) < 2:
        merged = [0.0, duration]

    sections = []
    for i in range(len(merged) - 1):
        start, end = merged[i], merged[i + 1]
        in_section = (rms_times >= start) & (rms_times < end)
        sec_energy = (
            float(energy_norm[in_section].mean()) if np.any(in_section) else 0.0
        )
        in_sec_beats = [t for t in beat_times if start <= t < end]
        if len(in_sec_beats) >= 2:
            sec_bpm = round(60.0 / float(np.median(np.diff(in_sec_beats))), 1)
        else:
            sec_bpm = bpm  # too few beats to measure — fall back to global
        sections.append(
            {
                "id": f"s{i}",
                "start": round(start, 2),
                "end": round(end, 2),
                "energy": round(sec_energy, 3),
                "bpm": sec_bpm,
            }
        )

    return {
        "duration": round(duration, 2),
        "bpm": bpm,
        "tempo_factor": tempo_factor,
        "beat_times": beat_times,
        "tempo_curve": tempo_curve,
        "energy_curve": energy_curve,
        "sections": sections,
    }


@app.post("/analyze-audio")
async def analyze_audio_endpoint(file: UploadFile = File(...)):
    if file.content_type not in ("audio/mpeg", "audio/mp3"):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Expected an MP3 file, got {file.content_type}. "
                "Only MP3 is accepted here."
            ),
        )

    audio_bytes = await file.read()
    MAX_BYTES = 30 * 1024 * 1024  # 30MB — generous for a several-minute MP3
    if len(audio_bytes) > MAX_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 30MB)")

    try:
        result = analyze_audio(audio_bytes)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return JSONResponse(result)


@app.get("/health")
async def health():
    return {"status": "ok"}

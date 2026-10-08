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

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv
import os

load_dotenv()

from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import io
import shutil
import subprocess
import cv2
import librosa
import numpy as np
from beat_tracking import track_beats
import random
import time
import resend


resend.api_key = os.getenv("RESEND_API_KEY")

verification_codes = {}


app = FastAPI(title="I-Parol Segmentation API")


# ---- Gmail verification ---------------------------------------------

class EmailRequest(BaseModel):
    email: str


@app.post("/auth/send-code")
async def send_verification_code(request: EmailRequest):
    email = request.email.strip().lower()

    if not email.endswith("@gmail.com"):
        raise HTTPException(
            status_code=400,
            detail="Please enter a Gmail address."
        )

    code = f"{random.randint(0, 999999):06d}"

    verification_codes[email] = {
        "code": code,
        "expires_at": time.time() + 600,
        "attempts": 0,
    }

    resend.Emails.send({
        "from": "onboarding@resend.dev",
        "to": email,
        "subject": "Your I-Parol verification code",
        "text": (
            f"Your I-Parol verification code is: {code}\n\n"
            "This code expires in 10 minutes."
        ),
    })

    return {"message": "Verification code sent."}


class VerifyCodeRequest(BaseModel):
    email: str
    code: str


@app.post("/auth/verify-code")
async def verify_code(request: VerifyCodeRequest):
    email = request.email.strip().lower()
    code = request.code.strip()

    stored = verification_codes.get(email)

    if not stored:
        raise HTTPException(
            status_code=400,
            detail="No verification code found. Please request a new code."
        )

    if time.time() > stored["expires_at"]:
        verification_codes.pop(email, None)
        raise HTTPException(
            status_code=400,
            detail="Verification code has expired."
        )

    if stored["attempts"] >= 5:
        verification_codes.pop(email, None)
        raise HTTPException(
            status_code=429,
            detail="Too many incorrect attempts. Please request a new code."
        )

    if code != stored["code"]:
        stored["attempts"] += 1
        raise HTTPException(
            status_code=400,
            detail="Incorrect verification code."
        )

    verification_codes.pop(email, None)

    return {"verified": True}


# Wide open for now (class project on a free tier) — tighten to the
# real frontend origin(s) once the Vercel/Netlify URL is known.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST"],
    allow_headers=["*"],
)


# ---- tunables -------------------------------------------------------

UPSCALE = 3
ANTIALIAS_KERNEL = 3

# ---- skeleton endpoint bridging ------------------------------------

BRIDGE_MAX_DIST_BASE = 40
BRIDGE_BASE_DIM = 1440
BRIDGE_MIN_DIST = 10
BRIDGE_MAX_DIST_CAP = 150
BRIDGE_LINE_THICKNESS = 3
BRIDGE_EDGE_MARGIN = 4

EXTRA_CLOSE_BASE = 3
EXTRA_CLOSE_MIN = 3
EXTRA_CLOSE_MAX = 11

MIN_ZONE_AREA_PX = 15
BACKGROUND_AREA_FRACTION = 0.30
SIMPLIFY_EPSILON_FRAC = 0.0025


def _bridge_gaps(walls: np.ndarray) -> np.ndarray:
    """Find broken line-ends via skeleton endpoints and seal only those
    specific gaps, directly on the wall mask. Returns a new wall mask;
    does not mutate the input.
    """
    walls = walls.copy()
    h, w = walls.shape

    skeleton = cv2.ximgproc.thinning(walls)

    binary_sk = (skeleton > 0).astype(np.uint8)

    neighbor_kernel = np.array(
        [[1, 1, 1],
         [1, 10, 1],
         [1, 1, 1]],
        dtype=np.uint8,
    )

    neighbor_count = cv2.filter2D(
        binary_sk,
        -1,
        neighbor_kernel,
        borderType=cv2.BORDER_CONSTANT,
    )

    endpoint_mask = (
        (binary_sk == 1)
        & (neighbor_count == 11)
    )

    ys, xs = np.where(endpoint_mask)

    if len(xs) < 2:
        return walls

    endpoints = np.stack([xs, ys], axis=1).astype(float)

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
        BRIDGE_MAX_DIST_BASE
        * (max(h, w) / BRIDGE_BASE_DIM)
    )

    bridge_max_dist = max(
        BRIDGE_MIN_DIST,
        min(bridge_max_dist, BRIDGE_MAX_DIST_CAP),
    )

    dists = np.linalg.norm(
        endpoints[:, None, :] - endpoints[None, :, :],
        axis=2,
    )

    np.fill_diagonal(dists, np.inf)

    n = len(endpoints)
    used = np.zeros(n, dtype=bool)

    flat_order = np.dstack(
        np.unravel_index(
            np.argsort(dists, axis=None),
            dists.shape,
        )
    )[0]

    for i, j in flat_order:
        if used[i] or used[j]:
            continue

        if dists[i, j] > bridge_max_dist:
            break

        p1 = tuple(endpoints[i].astype(int))
        p2 = tuple(endpoints[j].astype(int))

        cv2.line(
            walls,
            p1,
            p2,
            255,
            thickness=BRIDGE_LINE_THICKNESS,
        )

        used[i] = True
        used[j] = True

    extra_k = round(
        EXTRA_CLOSE_BASE
        * (max(h, w) / BRIDGE_BASE_DIM)
    )

    extra_k = max(
        EXTRA_CLOSE_MIN,
        min(extra_k, EXTRA_CLOSE_MAX),
    )

    if extra_k % 2 == 0:
        extra_k += 1

    extra_kernel = np.ones(
        (extra_k, extra_k),
        np.uint8,
    )

    walls = cv2.morphologyEx(
        walls,
        cv2.MORPH_CLOSE,
        extra_kernel,
        iterations=1,
    )

    return walls


# ---- image segmentation ---------------------------------------------

def segment_image(image_bytes: bytes) -> dict:
    arr = np.frombuffer(
        image_bytes,
        dtype=np.uint8,
    )

    img = cv2.imdecode(
        arr,
        cv2.IMREAD_UNCHANGED,
    )

    if img is None:
        raise ValueError(
            "Could not decode image — is it a valid PNG/JPG?"
        )

    if img.ndim == 3 and img.shape[2] == 4:
        bgr = img[:, :, :3].astype(float)

        alpha = (
            img[:, :, 3].astype(float)
            / 255.0
        )

        white = np.ones_like(bgr) * 255

        bgr = (
            bgr * alpha[..., None]
            + white * (1 - alpha[..., None])
        )

        img = bgr.astype(np.uint8)

    elif img.ndim == 2:
        img = cv2.cvtColor(
            img,
            cv2.COLOR_GRAY2BGR,
        )

    else:
        img = img[:, :, :3]

    native_h, native_w = img.shape[:2]

    img_big = cv2.resize(
        img,
        None,
        fx=UPSCALE,
        fy=UPSCALE,
        interpolation=cv2.INTER_CUBIC,
    )

    gray = cv2.cvtColor(
        img_big,
        cv2.COLOR_BGR2GRAY,
    )

    _, binary = cv2.threshold(
        gray,
        0,
        255,
        cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU,
    )

    kernel = np.ones(
        (ANTIALIAS_KERNEL, ANTIALIAS_KERNEL),
        np.uint8,
    )

    walls = cv2.morphologyEx(
        binary,
        cv2.MORPH_CLOSE,
        kernel,
        iterations=1,
    )

    walls = _bridge_gaps(walls)

    zone_mask = cv2.bitwise_not(walls)

    num_labels, labels, stats, centroids = (
        cv2.connectedComponentsWithStats(
            zone_mask,
            connectivity=4,
        )
    )

    h, w = gray.shape

    min_area_scaled = (
        MIN_ZONE_AREA_PX
        * (UPSCALE * UPSCALE)
    )

    zones = []

    for i in range(1, num_labels):
        area = stats[
            i,
            cv2.CC_STAT_AREA,
        ]

        x = stats[
            i,
            cv2.CC_STAT_LEFT,
        ]

        y = stats[
            i,
            cv2.CC_STAT_TOP,
        ]

        cw = stats[
            i,
            cv2.CC_STAT_WIDTH,
        ]

        ch = stats[
            i,
            cv2.CC_STAT_HEIGHT,
        ]

        touches_edges = (
            x <= 0
            and y <= 0
            and x + cw >= w - 1
            and y + ch >= h - 1
        )

        if (
            touches_edges
            and area > (
                w * h
                * BACKGROUND_AREA_FRACTION
            )
        ):
            continue

        if area < min_area_scaled:
            continue

        mask = (
            (labels == i)
            .astype(np.uint8)
            * 255
        )

        contours, _ = cv2.findContours(
            mask,
            cv2.RETR_EXTERNAL,
            cv2.CHAIN_APPROX_TC89_L1,
        )

        if not contours:
            continue

        c = max(
            contours,
            key=cv2.contourArea,
        )

        epsilon = (
            SIMPLIFY_EPSILON_FRAC
            * cv2.arcLength(c, True)
        )

        approx = cv2.approxPolyDP(
            c,
            epsilon,
            True,
        )

        pts = (
            approx.reshape(-1, 2)
            / UPSCALE
        ).round(1).tolist()

        if len(pts) < 3:
            continue

        zones.append(
            {
                "id": f"z{i}",
                "points": pts,
                "cx": round(
                    float(
                        centroids[i][0]
                        / UPSCALE
                    ),
                    1,
                ),
                "cy": round(
                    float(
                        centroids[i][1]
                        / UPSCALE
                    ),
                    1,
                ),
                "area": int(
                    area
                    / (UPSCALE * UPSCALE)
                ),
            }
        )

    return {
        "width": native_w,
        "height": native_h,
        "zone_count": len(zones),
        "zones": zones,
    }


@app.post("/segment")
async def segment(
    file: UploadFile = File(...),
):
    if file.content_type != "image/png":
        raise HTTPException(
            status_code=400,
            detail=(
                f"Expected a PNG line-art drawing, "
                f"got {file.content_type}. "
                "JPEG isn't accepted here — its "
                "compression blurs and adds noise "
                "around thin lines, which breaks "
                "or merges zones. Export/save the "
                "drawing as PNG instead."
            ),
        )

    image_bytes = await file.read()

    MAX_BYTES = 15 * 1024 * 1024

    if len(image_bytes) > MAX_BYTES:
        raise HTTPException(
            status_code=400,
            detail="File too large (max 15MB)",
        )

    try:
        result = segment_image(image_bytes)

    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=str(e),
        )

    if result["zone_count"] == 0:
        raise HTTPException(
            status_code=422,
            detail=(
                "No enclosed zones were found. "
                "Make sure the drawing has clean, "
                "fully closed black outlines with "
                "no gaps."
            ),
        )

    return JSONResponse(result)


# ---- audio analysis tunables ---------------------------------------

ENERGY_HOP_LENGTH = 512
ENERGY_BUCKET_SEC = 0.5

MIN_SECTION_SECONDS = 8
TARGET_SECTION_SECONDS = 20
MAX_CLIP_SECONDS = 120

MIN_SECTIONS = 2
MAX_SECTIONS = 12

BEAT_TIGHTNESS = 40

MIN_BPM = 70
MAX_BPM = 140

TEMPO_WINDOW_BEATS = 8


def _fix_octave(beat_times: list):
    """Fold the song's overall tempo into [MIN_BPM, MAX_BPM)."""

    factor = 1.0

    if len(beat_times) < 4:
        return beat_times, factor

    median_bpm = (
        60.0
        / float(
            np.median(
                np.diff(beat_times)
            )
        )
    )

    while (
        median_bpm >= MAX_BPM
        and len(beat_times) >= 4
    ):
        beat_times = beat_times[::2]
        median_bpm /= 2
        factor /= 2

    while median_bpm < MIN_BPM:
        doubled = []

        for a, b in zip(
            beat_times,
            beat_times[1:],
        ):
            doubled += [
                a,
                round((a + b) / 2, 3),
            ]

        doubled.append(beat_times[-1])

        beat_times = doubled
        median_bpm *= 2
        factor *= 2

    return beat_times, factor


def _local_bpm(beat_times: list) -> list:
    """BPM around each beat."""

    if len(beat_times) < 2:
        return []

    gaps = np.diff(
        np.array(beat_times)
    )

    half = TEMPO_WINDOW_BEATS // 2

    curve = []

    for i in range(len(gaps)):
        window = gaps[
            max(0, i - half):
            i + half + 1
        ]

        gap = float(
            np.median(window)
        )

        curve.append(
            {
                "time": beat_times[i],
                "bpm": round(
                    60.0 / gap,
                    1,
                ) if gap > 0 else 0.0,
            }
        )

    curve.append(
        {
            "time": beat_times[-1],
            "bpm": curve[-1]["bpm"],
        }
    )

    return curve


def _decode_via_ffmpeg(audio_bytes: bytes):
    """Fallback decoder using ffmpeg."""

    ffmpeg_bin = shutil.which("ffmpeg")

    if not ffmpeg_bin:
        raise ValueError(
            "ffmpeg is not installed or not on PATH — "
            "required to decode this MP3 "
            "(soundfile alone couldn't read it)."
        )

    try:
        result = subprocess.run(
            [
                ffmpeg_bin,
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                "pipe:0",
                "-f",
                "wav",
                "-ar",
                "44100",
                "-ac",
                "1",
                "pipe:1",
            ],
            input=audio_bytes,
            capture_output=True,
            timeout=120,
            check=True,
        )

    except subprocess.CalledProcessError as e:
        raise ValueError(
            "ffmpeg could not decode this file — "
            "it may be corrupted or not actually "
            f"an MP3. ffmpeg said: "
            f"{e.stderr.decode(errors='ignore').strip()}"
        )

    except subprocess.TimeoutExpired:
        raise ValueError(
            "ffmpeg took too long decoding this file."
        )

    return librosa.load(
        io.BytesIO(result.stdout),
        sr=None,
        mono=True,
    )


def _load_audio(audio_bytes: bytes):
    """Decode uploaded audio."""

    try:
        return librosa.load(
            io.BytesIO(audio_bytes),
            sr=None,
            mono=True,
        )

    except Exception as first_error:
        try:
            return _decode_via_ffmpeg(
                audio_bytes
            )

        except ValueError as fallback_error:
            raise ValueError(
                "soundfile couldn't read this MP3 "
                f"({first_error}), and the ffmpeg "
                "fallback also failed: "
                f"{fallback_error}"
            )


def analyze_audio(
    audio_bytes: bytes,
    clip_start: float = 0.0,
) -> dict:
    """Analyze an uploaded song."""

    try:
        y, sr = _load_audio(
            audio_bytes
        )

    except ValueError:
        raise

    except Exception as e:
        raise ValueError(
            "Could not decode audio — "
            "is this a valid MP3? "
            f"(underlying error: {e})"
        )

    source_duration = float(
        librosa.get_duration(
            y=y,
            sr=sr,
        )
    )

    if (
        clip_start < 0
        or clip_start >= source_duration
    ):
        raise ValueError(
            f"Start time {clip_start:.1f}s "
            "is outside the song "
            f"(song is {source_duration:.1f}s long)."
        )

    if (
        source_duration > MAX_CLIP_SECONDS
        or clip_start > 0
    ):
        start_sample = int(
            round(clip_start * sr)
        )

        end_sample = min(
            start_sample
            + int(
                round(
                    MAX_CLIP_SECONDS * sr
                )
            ),
            len(y),
        )

        y = y[
            start_sample:end_sample
        ]

    duration = float(
        librosa.get_duration(
            y=y,
            sr=sr,
        )
    )

    if duration < MIN_SECTION_SECONDS:
        raise ValueError(
            f"Selected clip is only "
            f"{duration:.1f}s long — too short "
            "to analyze meaningfully. Pick a "
            "window further from the end of the song."
        )

    # ---- BPM + beat timestamps ----

    beat_times, downbeat_times, beat_tracker = (
        track_beats(y, sr)
    )

    if beat_tracker == "librosa":
        beat_times, tempo_factor = _fix_octave(
            beat_times
        )
    else:
        tempo_factor = 1.0

    if len(beat_times) >= 2:
        bpm = round(
            60.0
            / float(
                np.median(
                    np.diff(beat_times)
                )
            ),
            1,
        )
    else:
        bpm = 0.0

    tempo_curve = _local_bpm(
        beat_times
    )

    # ---- energy curve ----

    rms = librosa.feature.rms(
        y=y,
        hop_length=ENERGY_HOP_LENGTH,
    )[0]

    rms_times = librosa.frames_to_time(
        np.arange(len(rms)),
        sr=sr,
        hop_length=ENERGY_HOP_LENGTH,
    )

    rms_max = (
        float(rms.max())
        if rms.max() > 0
        else 1.0
    )

    energy_norm = (
        rms / rms_max
    )

    bucket_count = max(
        1,
        int(
            np.ceil(
                duration
                / ENERGY_BUCKET_SEC
            )
        ),
    )

    energy_curve = []

    for b in range(bucket_count):
        t0 = (
            b
            * ENERGY_BUCKET_SEC
        )

        t1 = (
            (b + 1)
            * ENERGY_BUCKET_SEC
        )

        in_bucket = (
            (rms_times >= t0)
            & (rms_times < t1)
        )

        if np.any(in_bucket):
            e = float(
                energy_norm[
                    in_bucket
                ].mean()
            )
        else:
            e = (
                energy_curve[-1]["energy"]
                if energy_curve
                else 0.0
            )

        energy_curve.append(
            {
                "time": round(
                    t0,
                    2,
                ),
                "energy": round(
                    e,
                    3,
                ),
            }
        )

    # ---- structural sections ----

    mfcc = librosa.feature.mfcc(
        y=y,
        sr=sr,
        n_mfcc=13,
        hop_length=ENERGY_HOP_LENGTH,
    )

    chroma = librosa.feature.chroma_cqt(
        y=y,
        sr=sr,
        hop_length=ENERGY_HOP_LENGTH,
    )

    n_frames = min(
        mfcc.shape[1],
        chroma.shape[1],
    )

    features = np.vstack(
        [
            mfcc[:, :n_frames],
            chroma[:, :n_frames],
        ]
    )

    target_k = round(
        duration
        / TARGET_SECTION_SECONDS
    )

    k = max(
        MIN_SECTIONS,
        min(
            target_k,
            MAX_SECTIONS,
        ),
    )

    boundary_frames = (
        librosa.segment.agglomerative(
            features,
            k,
        )
    )

    boundary_times = (
        librosa.frames_to_time(
            boundary_frames,
            sr=sr,
            hop_length=ENERGY_HOP_LENGTH,
        )
    )

    boundary_times = sorted(
        set(
            [
                0.0
            ]
            + boundary_times.round(
                3
            ).tolist()
            + [
                duration
            ]
        )
    )

    merged = [
        boundary_times[0]
    ]

    for t in boundary_times[1:]:
        if (
            t - merged[-1]
            < MIN_SECTION_SECONDS
            and t != duration
        ):
            continue

        merged.append(t)

    if len(merged) < 2:
        merged = [
            0.0,
            duration,
        ]

    sections = []

    for i in range(
        len(merged) - 1
    ):
        start = merged[i]
        end = merged[i + 1]

        in_section = (
            (rms_times >= start)
            & (rms_times < end)
        )

        sec_energy = (
            float(
                energy_norm[
                    in_section
                ].mean()
            )
            if np.any(in_section)
            else 0.0
        )

        in_sec_beats = [
            t
            for t in beat_times
            if start <= t < end
        ]

        if len(in_sec_beats) >= 2:
            sec_bpm = round(
                60.0
                / float(
                    np.median(
                        np.diff(
                            in_sec_beats
                        )
                    )
                ),
                1,
            )
        else:
            sec_bpm = bpm

        sections.append(
            {
                "id": f"s{i}",
                "start": round(
                    start,
                    2,
                ),
                "end": round(
                    end,
                    2,
                ),
                "energy": round(
                    sec_energy,
                    3,
                ),
                "bpm": sec_bpm,
            }
        )

    return {
        "duration": round(
            duration,
            2,
        ),
        "source_duration": round(
            source_duration,
            2,
        ),
        "clip_start": round(
            clip_start,
            2,
        ),
        "bpm": bpm,
        "tempo_factor": tempo_factor,
        "beat_tracker": beat_tracker,
        "beat_times": beat_times,
        "downbeat_times": downbeat_times,
        "tempo_curve": tempo_curve,
        "energy_curve": energy_curve,
        "sections": sections,
    }


@app.post("/analyze-audio")
async def analyze_audio_endpoint(
    file: UploadFile = File(...),
    start: float = Form(0.0),
):
    if file.content_type not in (
        "audio/mpeg",
        "audio/mp3",
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Expected an MP3 file, "
                f"got {file.content_type}. "
                "Only MP3 is accepted here."
            ),
        )

    audio_bytes = await file.read()

    MAX_BYTES = 30 * 1024 * 1024

    if len(audio_bytes) > MAX_BYTES:
        raise HTTPException(
            status_code=400,
            detail="File too large (max 30MB)",
        )

    if start < 0:
        raise HTTPException(
            status_code=400,
            detail="start cannot be negative",
        )

    try:
        result = analyze_audio(
            audio_bytes,
            clip_start=start,
        )

    except ValueError as e:
        raise HTTPException(
            status_code=400,
            detail=str(e),
        )

    return JSONResponse(result)


@app.get("/health")
async def health():
    return {"status": "ok"}
"""
beat_tracking.py -- drop into backend/ next to main.py.

Design (from handoff section 7): decode ONCE through ffmpeg, then hand the
same clean waveform to whichever tracker runs. Beat This! never touches the
raw MP3 or its own torchaudio/soundfile/madmom loader, so malformed MP3s
(libmpg123 "junk" errors) can't break it.

Usage inside analyze_audio(), AFTER the waveform is decoded (and after the
2-minute clip slice), where you currently call librosa.beat.beat_track():

    from beat_tracking import track_beats

    beat_times, downbeat_times, tracker = track_beats(y, sr)

    if tracker == "librosa":
        # existing path: keep your _fix_octave() call here
        ...
    else:
        # Beat This! -> skip _fix_octave(), set tempo_factor = 1.0
        ...

Env flag: BEAT_TRACKER=librosa forces the old path (default: beat_this,
with automatic fallback to librosa if it is not installed or errors).
"""

import os
import logging
from typing import List, Optional, Tuple

import numpy as np

log = logging.getLogger(__name__)

BEAT_THIS_SR = 22050  # Beat This! works at 22.05 kHz

_model = None  # loaded once per process (checkpoint load is slow)


def _get_model():
    global _model
    if _model is None:
        from beat_this.inference import Audio2Beats  # lazy: torch is heavy

        _model = Audio2Beats(checkpoint_path="final0", device="cpu", dbn=False)
        log.info("Beat This! model loaded")
    return _model


def _prepare_signal(y: np.ndarray, sr: int) -> np.ndarray:
    """Mono float32 at 22.05 kHz from the ffmpeg-decoded waveform."""
    if y.ndim > 1:
        # accept (samples, channels) or (channels, samples)
        y = y.mean(axis=1) if y.shape[0] > y.shape[1] else y.mean(axis=0)
    y = y.astype(np.float32, copy=False)
    if sr != BEAT_THIS_SR:
        import librosa

        y = librosa.resample(y, orig_sr=sr, target_sr=BEAT_THIS_SR)
    return np.ascontiguousarray(y)


def _beat_this(y: np.ndarray, sr: int) -> Tuple[List[float], List[float]]:
    signal = _prepare_signal(y, sr)
    beats, downbeats = _get_model()(signal, BEAT_THIS_SR)
    return (
        [round(float(t), 3) for t in beats],
        [round(float(t), 3) for t in downbeats],
    )


def _librosa_beats(y: np.ndarray, sr: int, tightness: float = 40) -> List[float]:
    """Fallback. Mirrors the existing path (BEAT_TIGHTNESS = 40)."""
    import librosa

    if y.ndim > 1:
        y = y.mean(axis=1) if y.shape[0] > y.shape[1] else y.mean(axis=0)
    _, frames = librosa.beat.beat_track(y=y, sr=sr, tightness=tightness)
    return [round(float(t), 3) for t in librosa.frames_to_time(frames, sr=sr)]


def track_beats(
    y: np.ndarray, sr: int, force: Optional[str] = None
) -> Tuple[List[float], List[float], str]:
    """
    Returns (beat_times, downbeat_times, tracker_used).
    tracker_used is "beat_this" or "librosa". Downbeats are [] for librosa.
    Times are relative to the start of `y` (i.e. clip-relative, same as
    the rest of the /analyze-audio response).
    """
    choice = (force or os.environ.get("BEAT_TRACKER", "beat_this")).lower()

    if choice != "librosa":
        try:
            beats, downbeats = _beat_this(y, sr)
            if len(beats) >= 4:
                return beats, downbeats, "beat_this"
            log.warning("Beat This! returned too few beats; falling back")
        except Exception as e:  # ImportError, torch failure, etc.
            log.warning("Beat This! failed (%s); falling back to librosa", e)

    return _librosa_beats(y, sr), [], "librosa"

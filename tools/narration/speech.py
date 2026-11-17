"""Select a local speech device and retry a failed Apple GPU operation on the CPU."""
import os
import platform
import sys


class SpeechModel:
    def __init__(self, load, has_mps, default_device):
        self.load = load
        self.model = None
        self.mode = os.environ.get("VIZMATIC_NARRATION_DEVICE", "auto")
        if self.mode not in ("auto", "cpu", "mps"):
            raise ValueError("VIZMATIC_NARRATION_DEVICE must be auto, cpu or mps")
        apple = sys.platform == "darwin" and platform.machine() == "arm64"
        if self.mode == "mps" and not (apple and has_mps()):
            raise RuntimeError("MPS was requested but is unavailable in this speech engine")
        self.device = self.mode if self.mode != "auto" else ("mps" if apple and has_mps() else default_device)

    def run(self, operation):
        """Run one complete take or transcription so a failed GPU attempt cannot return partial output."""
        try:
            if self.model is None:
                self.model = self.load(self.device)
                print(f"speech: using {self.device}", file=sys.stderr, flush=True)
            return operation(self.model)
        except (RuntimeError, ValueError) as error:
            describes_mps = any(word in str(error).lower() for word in ("mps", "metal", "out of memory"))
            if self.mode != "auto" or self.device != "mps" or not describes_mps:
                raise
            print(f"speech: MPS failed ({error}). Retrying on CPU.", file=sys.stderr, flush=True)
        self.device = "cpu"
        self.model = None
        return self.run(operation)


def whisper():
    import ctranslate2
    from faster_whisper import WhisperModel

    return SpeechModel(
        lambda device: WhisperModel("small.en", device=device, compute_type="float16" if device == "mps" else "int8"),
        lambda: hasattr(ctranslate2, "get_mps_device_count") and ctranslate2.get_mps_device_count() > 0,
        "cpu",
    )


def segments(model, audio, **options):
    # Whisper performs inference while the iterator is consumed.
    return model.run(lambda engine: list(engine.transcribe(audio, **options)[0]))

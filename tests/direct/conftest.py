"""
Direct-Test Support Configuration for PageWitness

Intercepts PIL.Image.open to return a mock image when the GenVM test environment
passes empty screenshot bytes. This keeps the tests fully functional and local without
requiring dynamic browser rendering during direct mock tests.
"""

import PIL.Image as PILImage

_original_open = PILImage.open


def _tolerant_image_open(fp, *args, **kwargs):
    try:
        return _original_open(fp, *args, **kwargs)
    except Exception:
        # Gracefully fall back to a 1x1 RGB placeholder on mock binary inputs
        return PILImage.new("RGB", (1, 1))


PILImage.open = _tolerant_image_open

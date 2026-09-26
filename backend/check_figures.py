"""Run with python -m backend.check_figures; generated fixtures are not research data."""
import hashlib

import pymupdf

from .pdf import extract_pdf_region


def main():
    with pymupdf.open() as fixture:
        page = fixture.new_page(width=300, height=200)
        page.draw_rect((20, 30, 80, 90), color=(1, 0, 0), fill=(1, 0, 0))
        page.insert_text((100, 120), 'Generated check fixture')
        page.set_rotation(90)
        raw = fixture.tobytes()
    digest = hashlib.sha256(raw).hexdigest()
    # A 90-degree rotation maps the red rectangle to x=110..170, y=20..80.
    png, provenance = extract_pdf_region(raw, digest, 1, [110, 20, 170, 80])
    pixels = pymupdf.Pixmap(png)
    assert (pixels.width, pixels.height) == (120, 120)
    assert pixels.pixel(60, 60) == (255, 0, 0), 'Crop must follow displayed coordinates'
    assert provenance['source_sha256'] == digest and provenance['page'] == 1
    assert provenance['rect'] == [110, 20, 170, 80]
    assert provenance['sha256'] == hashlib.sha256(png).hexdigest()
    assert extract_pdf_region(raw, digest, 1, [110, 20, 170, 80]) == (png, provenance)
    full, metadata = extract_pdf_region(raw, digest, 1)
    assert metadata['kind'] == 'page_image'
    full_pixels = pymupdf.Pixmap(full)
    assert (full_pixels.width, full_pixels.height) == (400, 600)
    for checksum, number, rect in [
        ('0' * 64, 1, None), (digest, 2, None), (digest, True, None),
        (digest, 1, [-1, 0, 10, 10]), (digest, 1, [10, 10, 0, 0]),
        (digest, 1, [0, 0, float('nan'), 10]), (digest, 1, [0, 0, 0, 0]),
    ]:
        try:
            extract_pdf_region(raw, checksum, number, rect)
        except ValueError:
            pass
        else:
            raise AssertionError('Invalid version/page/crop must fail')
    print('PASS version-bound PDF region extraction, rotation, repeatability and invalid inputs')


if __name__ == '__main__':
    main()

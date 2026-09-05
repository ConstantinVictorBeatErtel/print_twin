"""Validate and convert local capture media; never upload it. Requires Pillow/imageio-ffmpeg."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

from PIL import Image, ImageOps
import imageio_ffmpeg


def inspect(path):
    path = Path(path)
    if path.suffix.lower() in {'.mp4', '.mov', '.webm', '.avi'}:
        result = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-i', str(path)], capture_output=True, text=True)
        match = re.search(r'Duration: (\d+):(\d+):([\d.]+)', result.stderr)
        if not match:
            raise ValueError(f'Cannot read video duration: {path.name}')
        h, m, s = map(float, match.groups())
        duration = h * 3600 + m * 60 + s
        if not 0 < duration <= 30 or path.stat().st_size > 100_000_000:
            raise ValueError('Video must be at most 30 seconds and 100 MB')
        return {'file': str(path), 'kind': 'video', 'durationSeconds': duration, 'bytes': path.stat().st_size}
    with Image.open(path) as image:
        image.load()
        w, h = image.size
        if path.stat().st_size > 20_000_000:
            raise ValueError('Image must be at most 20 MB')
        return {'file': str(path), 'kind': 'image', 'width': w, 'height': h, 'bytes': path.stat().st_size}


def prepare(path, output):
    path, output = Path(path), Path(output)
    output.mkdir(parents=True, exist_ok=True)
    if path.suffix.lower() in {'.mp4', '.mov', '.webm', '.avi'}:
        inspect(path)
        destination = output / (path.stem + '.mp4')
        if destination.resolve() == path.resolve():
            raise ValueError('Output must differ from input')
        # iPhone HLG HDR -> linear -> SDR BT.709. Autorotation bakes portrait orientation.
        ff = imageio_ffmpeg.get_ffmpeg_exe()
        metadata = subprocess.run([ff, '-i', str(path)], capture_output=True, text=True).stderr
        hdr = 'arib-std-b67' in metadata or 'smpte2084' in metadata
        filters = ('zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,'
                   'tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,' if hdr else '')
        filters += "scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p"
        subprocess.run([ff, '-n', '-i', str(path), '-map','0:v:0', '-an', '-map_metadata','-1',
                        '-vf', filters, '-c:v', 'libx264', '-crf', '18', '-preset','medium',
                        '-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709',
                        '-movflags', '+faststart', str(destination)], check=True, capture_output=True)
    else:
        destination = output / (path.stem + '.jpg')
        if destination.exists():
            raise ValueError(f'Output already exists: {destination}')
        with tempfile.TemporaryDirectory() as temporary:
            decoded = path
            if path.suffix.lower() in {'.heic', '.heif'}:
                decoded = Path(temporary)/'decoded.jpg'
                subprocess.run(['sips','-s','format','jpeg',str(path),'--out',str(decoded)], check=True, capture_output=True)
            image = ImageOps.exif_transpose(Image.open(decoded)).convert('RGB')
            image.thumbnail((2048,2048))
            image.save(destination, quality=92)
    return inspect(destination)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inspect', action='store_true')
    parser.add_argument('--out', default='data/captures/prepared')
    parser.add_argument('files', nargs='+')
    args = parser.parse_args()
    try:
        results = [inspect(p) if args.inspect else prepare(p,args.out) for p in args.files]
        print(json.dumps(results,indent=2))
    except Exception as error:
        print(str(error),file=sys.stderr)
        sys.exit(1)

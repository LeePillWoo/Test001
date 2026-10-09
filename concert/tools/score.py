#!/usr/bin/env python3
"""모든 기법을 렌더해 원본과 비교하고 js/scores.js와 미리보기 이미지를 만든다.

    python3 concert/tools/score.py            # 전부
    python3 concert/tools/score.py strokes    # 일부만 (나머지 점수는 유지)

js/scores.js 형식
    window.ConcertScores = { <id>: { ssim, ssim_small, dE, codeBytes, dataBytes, mountMs } }
assets/thumbs/<id>.jpg 는 목록에 쓰는 작은 미리보기다.
"""
import json
import os
import re
import subprocess
import sys
import tempfile

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SCORES = os.path.join(ROOT, 'js', 'scores.js')
THUMBS = os.path.join(ROOT, 'assets', 'thumbs')


def method_ids():
    src = open(os.path.join(ROOT, 'js', 'methods.js'), encoding='utf-8').read()
    return re.findall(r"id:\s*'([\w-]+)'", src)


def sizes(method_id):
    """기법 폴더의 코드/데이터 바이트. 생성된 데이터 파일(data*.js, data/ 아래)은 데이터로 센다."""
    folder = os.path.join(ROOT, 'js', method_id)
    code = data = 0
    for dirpath, _, files in os.walk(folder):
        for fn in files:
            path = os.path.join(dirpath, fn)
            n = os.path.getsize(path)
            rel = os.path.relpath(path, folder)
            if rel.startswith('data') or fn.startswith('data'):
                data += n
            else:
                code += n
    return code, data


def load_existing():
    if not os.path.exists(SCORES):
        return {}
    m = re.search(r'window\.ConcertScores\s*=\s*(\{.*\});', open(SCORES, encoding='utf-8').read(), re.S)
    return json.loads(m.group(1)) if m else {}


def main():
    ids = sys.argv[1:] or method_ids()
    scores = load_existing()
    os.makedirs(THUMBS, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for mid in ids:
            png = os.path.join(tmp, f'{mid}.png')
            r = subprocess.run(
                ['node', os.path.join(HERE, 'render.js'), '--method', mid, '--out', png],
                capture_output=True,
                text=True,
            )
            if r.returncode != 0:
                print(f'{mid}: 렌더 실패\n{r.stderr}', file=sys.stderr)
                continue
            mount_ms = json.loads(r.stdout).get('mountMs')
            c = subprocess.run(
                [sys.executable, os.path.join(HERE, 'compare.py'), png], capture_output=True, text=True, check=True
            )
            m = json.loads(c.stdout)
            code, data = sizes(mid)
            scores[mid] = {
                'ssim': m['ssim'],
                'ssim_small': m['ssim_small'],
                'dE': m['dE'],
                'codeBytes': code,
                'dataBytes': data,
                'mountMs': mount_ms,
            }
            Image.open(png).convert('RGB').resize((240, 240), Image.LANCZOS).save(
                os.path.join(THUMBS, f'{mid}.jpg'), quality=86
            )
            print(f"{mid}: ssim_small {m['ssim_small']}  dE {m['dE']}  code {code}B  data {data}B  mount {mount_ms}ms")
    ordered = {k: scores[k] for k in method_ids() if k in scores}
    with open(SCORES, 'w', encoding='utf-8') as f:
        f.write('// tools/score.py가 만든다. 직접 고치지 않는다.\n')
        f.write('window.ConcertScores = ' + json.dumps(ordered, ensure_ascii=False, indent=2) + ';\n')


if __name__ == '__main__':
    main()

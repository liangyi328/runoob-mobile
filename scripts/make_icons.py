"""生成 PWA / APK 图标：绿色圆角底 + 白色「菜鸟」字样。"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "app", "icons")
os.makedirs(OUT, exist_ok=True)

BG = (14, 122, 95, 255)      # --brand
FG = (255, 255, 255, 255)


def find_font(size):
    """按优先级查找系统中文字体。"""
    candidates = []
    windir = os.environ.get("WINDIR", r"C:\Windows")
    fonts = [
        os.path.join(windir, "Fonts", "msyhbd.ttc"),   # 微软雅黑 Bold
        os.path.join(windir, "Fonts", "msyh.ttc"),     # 微软雅黑
        os.path.join(windir, "Fonts", "simhei.ttf"),   # 黑体
        os.path.join(windir, "Fonts", "simsun.ttc"),   # 宋体
        os.path.join(windir, "Fonts", "arialbd.ttf"),
        os.path.join(windir, "Fonts", "arial.ttf"),
    ]
    for f in fonts:
        if os.path.exists(f):
            candidates.append(f)
    for f in candidates:
        try:
            return ImageFont.truetype(f, size)
        except Exception:
            continue
    return ImageFont.load_default()


def make(size, radius_ratio=0.22, text="菜鸟"):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 圆角矩形背景
    r = int(size * radius_ratio)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=BG)

    # 文字居中
    fs = int(size * 0.34)
    font = find_font(fs)
    try:
        bbox = d.textbbox((0, 0), text, font=font)
        w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
        x = (size - w) / 2 - bbox[0]
        y = (size - h) / 2 - bbox[1]
        d.text((x, y), text, font=font, fill=FG)
    except Exception:
        # 无可用字体时退化为字母 R
        fs = int(size * 0.5)
        font = find_font(fs)
        bbox = d.textbbox((0, 0), "R", font=font)
        d.text(((size - (bbox[2] - bbox[0])) / 2, (size - (bbox[3] - bbox[1])) / 2),
               "R", font=font, fill=FG)

    return img


for s in (192, 512):
    img = make(s)
    p = os.path.join(OUT, f"icon-{s}.png")
    img.save(p, "PNG", optimize=True)
    print(f"  icon-{s}.png ({os.path.getsize(p)} bytes)")

# Android 自适应图标前景（APK 用）
ad = make(432, radius_ratio=0.0)  # 前景通常透明底
ad.save(os.path.join(OUT, "android-foreground.png"), "PNG", optimize=True)
print("  android-foreground.png")

print("图标生成完成 ->", OUT)

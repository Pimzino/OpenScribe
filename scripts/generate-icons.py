#!/usr/bin/env python3
"""
StepSnap Logo Processor
Generates all required icon variants from the source logo.jpg
"""

from PIL import Image, ImageDraw, ImageFont
import os
import sys

# Configuration
SOURCE_LOGO = "public/logo/logo.jpg"
OUTPUT_DIR = "public/logo"
BRAND_COLORS = {
    "primary_blue": "#2721E8",
    "cyan": "#49B8D3",
    "green": "#22c55e",
}

def ensure_output_dir():
    """Create output directory if it doesn't exist"""
    os.makedirs(OUTPUT_DIR, exist_ok=True)

def remove_background_color(img, bg_color_threshold=45):
    """
    Remove dark background and make it transparent.
    Uses a more sophisticated approach with edge detection.
    Returns RGBA image with transparent background.
    """
    # Convert to RGBA
    img = img.convert("RGBA")
    datas = list(img.getdata())
    
    new_data = []
    for item in datas:
        r, g, b, a = item
        
        # Check if pixel is dark (background)
        # The background is dark gray/black
        brightness = (r + g + b) / 3
        if brightness < bg_color_threshold:
            # Make it transparent
            new_data.append((0, 0, 0, 0))
        else:
            new_data.append(item)
    
    img.putdata(new_data)
    return img

def crop_to_icon(img):
    """
    Crop the image to just the icon (remove the StepSnap text in top left).
    The icon is the large rounded square in the center.
    """
    width, height = img.size
    
    # The icon is centered, roughly from 10% to 90% of width/height
    # The text "StepSnap" is in the top left corner
    left = int(width * 0.10)
    top = int(height * 0.12)  # Skip the text area at top
    right = int(width * 0.90)
    bottom = int(height * 0.90)
    
    return img.crop((left, top, right, bottom))

def create_tray_icon(source_img, size=32):
    """Create a small tray icon (32x32)"""
    # First crop to just the icon
    icon = crop_to_icon(source_img)
    
    # Remove background
    icon = remove_background_color(icon)
    
    # Resize to target size
    icon = icon.resize((size, size), Image.Resampling.LANCZOS)
    
    return icon

def create_window_icon(source_img, sizes=[16, 32, 48, 256]):
    """Create window icons in multiple sizes"""
    icons = {}
    
    # Process the source
    icon = crop_to_icon(source_img)
    icon = remove_background_color(icon)
    
    for size in sizes:
        resized = icon.resize((size, size), Image.Resampling.LANCZOS)
        icons[size] = resized
    
    return icons

def create_horizontal_logo(source_img, text="StepSnap"):
    """
    Create horizontal logo with icon on left and text on right.
    Icon + "StepSnap" side by side.
    """
    # Get the icon
    icon = crop_to_icon(source_img)
    icon = remove_background_color(icon)
    
    # Resize icon to appropriate size
    icon_size = 128
    icon = icon.resize((icon_size, icon_size), Image.Resampling.LANCZOS)
    
    # Try to load a nice font first to calculate sizes
    try:
        font_paths = [
            "C:/Windows/Fonts/segoeui.ttf",  # Windows
            "C:/Windows/Fonts/arial.ttf",  # Windows fallback
            "/System/Library/Fonts/Helvetica.ttc",  # macOS
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",  # Linux
        ]
        
        font_large = None
        for font_path in font_paths:
            if os.path.exists(font_path):
                font_large = ImageFont.truetype(font_path, 72)
                break
        
        if font_large is None:
            font_large = ImageFont.load_default()
    except:
        font_large = ImageFont.load_default()
    
    # Calculate text widths first
    step_text = "Step"
    snap_text = "Snap"
    
    # Use textbbox to get accurate width
    temp_img = Image.new('RGBA', (1, 1))
    temp_draw = ImageDraw.Draw(temp_img)
    
    bbox_step = temp_draw.textbbox((0, 0), step_text, font=font_large)
    step_width = bbox_step[2] - bbox_step[0]
    
    bbox_snap = temp_draw.textbbox((0, 0), snap_text, font=font_large)
    snap_width = bbox_snap[2] - bbox_snap[0]
    
    total_text_width = step_width + snap_width + 5  # 5px gap between words
    text_height = bbox_step[3] - bbox_step[1]
    
    # Create canvas with proper size
    padding = 40
    icon_text_gap = 30
    extra_padding = 40  # Extra space on right to ensure text fits
    width = padding + icon_size + icon_text_gap + total_text_width + extra_padding
    height = max(icon_size + 40, text_height + 60)
    
    canvas = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    
    # Paste icon
    icon_y = (height - icon_size) // 2
    canvas.paste(icon, (padding, icon_y), icon)
    
    # Add text
    draw = ImageDraw.Draw(canvas)
    
    # Calculate vertical centering
    text_x = padding + icon_size + icon_text_gap
    text_y = (height - text_height) // 2 - 5  # Slight adjustment
    
    # Draw "Step" in dark blue
    draw.text((text_x, text_y), step_text, fill="#2721E8", font=font_large)
    
    # Draw "Snap" in cyan
    snap_x = text_x + step_width + 5
    draw.text((snap_x, text_y), snap_text, fill="#49B8D3", font=font_large)
    
    return canvas

def create_ico_file(png_path, ico_path):
    """Convert PNG to ICO format using PIL"""
    img = Image.open(png_path)
    
    # ICO format supports multiple sizes
    # Create sizes: 16, 32, 48, 256
    sizes = [(16, 16), (32, 32), (48, 48), (256, 256)]
    
    # For ICO, we need to save with all sizes
    # PIL handles this automatically when saving as .ico
    img.save(ico_path, format='ICO', sizes=sizes)
    print(f"Created ICO file: {ico_path}")

def copy_to_tauri_icons():
    """Copy generated icons to src-tauri/icons directory"""
    tauri_icons_dir = "src-tauri/icons"
    
    if not os.path.exists(tauri_icons_dir):
        print(f"Warning: {tauri_icons_dir} does not exist, skipping copy")
        return
    
    # Copy main icon files
    files_to_copy = [
        ("icon.png", "icon.png"),
        ("icon.ico", "icon.ico"),
        ("icon-32x32.png", "32x32.png"),
        ("icon-128x128.png", "128x128.png"),
        ("icon-256x256.png", "128x128@2x.png"),  # For macOS retina
    ]
    
    for src_name, dest_name in files_to_copy:
        src = os.path.join(OUTPUT_DIR, src_name)
        dest = os.path.join(tauri_icons_dir, dest_name)
        if os.path.exists(src):
            from shutil import copy2
            copy2(src, dest)
            print(f"   Copied to Tauri: {dest}")

def main():
    ensure_output_dir()
    
    # Load source image
    print(f"Loading source image: {SOURCE_LOGO}")
    if not os.path.exists(SOURCE_LOGO):
        print(f"ERROR: Source file not found: {SOURCE_LOGO}")
        print("Please ensure logo.jpg exists in public/logo/")
        sys.exit(1)
    
    source = Image.open(SOURCE_LOGO)
    print(f"Source image size: {source.size}")
    
    # 1. Create tray icon (32x32 PNG with transparency)
    print("\n1. Creating tray icon...")
    tray_icon = create_tray_icon(source, size=32)
    tray_path = os.path.join(OUTPUT_DIR, "tray-icon.png")
    tray_icon.save(tray_path, "PNG")
    print(f"   Saved: {tray_path}")
    
    # Also create 16x16 for smaller tray
    tray_icon_16 = create_tray_icon(source, size=16)
    tray_path_16 = os.path.join(OUTPUT_DIR, "tray-icon-16.png")
    tray_icon_16.save(tray_path_16, "PNG")
    print(f"   Saved: {tray_path_16}")
    
    # 2. Create window icons (multiple sizes)
    print("\n2. Creating window icons...")
    window_icons = create_window_icon(source)
    
    for size, icon in window_icons.items():
        icon_path = os.path.join(OUTPUT_DIR, f"icon-{size}x{size}.png")
        icon.save(icon_path, "PNG")
        print(f"   Saved: {icon_path}")
    
    # Create main icon.png (512x512 for Tauri)
    print("\n3. Creating main icon.png (512x512)...")
    main_icon = crop_to_icon(source)
    main_icon = remove_background_color(main_icon)
    main_icon = main_icon.resize((512, 512), Image.Resampling.LANCZOS)
    main_icon_path = os.path.join(OUTPUT_DIR, "icon.png")
    main_icon.save(main_icon_path, "PNG")
    print(f"   Saved: {main_icon_path}")
    
    # 4. Create horizontal logo (icon + text)
    print("\n4. Creating horizontal logo...")
    try:
        horizontal = create_horizontal_logo(source)
        horizontal_path = os.path.join(OUTPUT_DIR, "logo-horizontal.png")
        horizontal.save(horizontal_path, "PNG")
        print(f"   Saved: {horizontal_path}")
    except Exception as e:
        print(f"   Warning: Could not create horizontal logo: {e}")
    
    # 5. Create ICO file for Windows
    print("\n5. Creating Windows ICO file...")
    try:
        ico_path = os.path.join(OUTPUT_DIR, "icon.ico")
        # Use the 256x256 version as base for ICO
        icon_256 = window_icons[256].convert("RGBA")
        icon_256.save(ico_path, format='ICO', sizes=[(16,16), (32,32), (48,48), (256,256)])
        print(f"   Saved: {ico_path}")
    except Exception as e:
        print(f"   Warning: Could not create ICO file: {e}")
    
    print("\n✅ All icons generated successfully!")
    print(f"\nOutput directory: {OUTPUT_DIR}")
    print("\nFiles created:")
    for f in os.listdir(OUTPUT_DIR):
        filepath = os.path.join(OUTPUT_DIR, f)
        size = os.path.getsize(filepath)
        print(f"  - {f} ({size/1024:.1f} KB)")

if __name__ == "__main__":
    main()

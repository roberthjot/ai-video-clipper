import os
import time
import json
import argparse
import sys
import re
import subprocess
from dotenv import load_dotenv
from google import genai
from google.genai import types
import imageio_ffmpeg

# 1. Configuration & Setup
load_dotenv()

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
if not GOOGLE_API_KEY:
    print("Error: GOOGLE_API_KEY not found in environment variables.")
    print("Please create a .env file based on .env.example and add your API key.")
    sys.exit(1)

client = genai.Client(api_key=GOOGLE_API_KEY)
MODEL_ID = "gemini-3-pro-preview"

# 2. Key Functions

def setup_directories(video_name, custom_folder=None):
    if custom_folder:
        output_dir = custom_folder
    else:
        base_name = os.path.splitext(os.path.basename(video_name))[0]
        base_name = "".join([c for c in base_name if c.isalnum() or c in ('_', '-')])
        output_dir = f"processed_clips_{base_name}"
    
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
        print(f"Created output directory: {output_dir}")
    return output_dir


def upload_video(file_path):
    print(f"Uploading {file_path} to Gemini...")
    try:
        if not os.path.exists(file_path):
             raise FileNotFoundError(f"Video file not found: {file_path}")

        file_upload = client.files.upload(file=file_path)
        print(f"Upload complete. URI: {file_upload.uri}")
        return file_upload
    except Exception as e:
        print(f"Failed to upload video: {e}")
        sys.exit(1)

def wait_for_processing(file_obj):
    print("Waiting for video processing...")
    while True:
        retrieved_file = client.files.get(name=file_obj.name)
        if retrieved_file.state == "ACTIVE":
            print("Video processing complete.")
            return retrieved_file
        elif retrieved_file.state == "FAILED":
            print("Video processing failed.")
            sys.exit(1)
        
        print("Processing...", end="\r")
        time.sleep(5)

def get_video_duration(file_path):
    try:
        if os.name == 'nt':
            # Fast probe with ffprobe on Windows using subprocess to avoid MoviePy overhead
            cmd = ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file_path]
            result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            return float(result.stdout.strip())
    except:
        pass
    # Fallback to MoviePy
    try:
        with VideoFileClip(file_path) as clip:
            return clip.duration
    except:
        return 600.0 # Default fallback

def analyze_video_for_clips(file_obj, video_path, target_clips=10, min_duration=15, start_time_offset=0, override_duration=None):
    print(f"Analyzing video with model: {MODEL_ID}...")
    
    if override_duration:
        video_duration = override_duration
    else:
        video_duration = get_video_duration(video_path)
        
    print(f"Detected Video Duration: {video_duration:.2f}s")
    
    # Prompt: Fresh analysis for new video
    system_prompt = f"""
    You are an expert viral video editor specializing in TikTok content for an immense American audience. 
    Your task is to watch the entire video provided and identify the BEST {target_clips} clips that have the highest potential to go viral.
    
    Target Audience: USA (English).
    Platform: TikTok / Reels / Shorts.
    
    Goal: Identify exactly {target_clips} clips.
    Constraint: Each clip MUST be at least {min_duration} seconds long.
    
    INSTRUCTION: Focus on EVERYTHING viral-worthy. Drama, emotions, funny moments, production secrets, or intensity. Captures clips of ALL characters (Piper, squad, etc). Prioritize "Viral Impact". Duration is flexible (min 15s).
    
    IMPORTANT - CAPTION STYLE:
    - The captions MUST be in **THIRD PERSON** (e.g., "She bought a car", "Look at her reaction").
    - DO NOT use "I", "Me", "My", or "POV: You...".
    - Write as if you are a fan account reporting on the creator.
    
    Output Format:
    Return ONLY a raw JSON list of objects. Do not include markdown formatting (like ```json).
    Each object must have:
    - "start_time": (float) Start time in seconds.
    - "end_time": (float) End time in seconds.
    - "description": (string) A very short 3-5 word label for the clip (English).
    - "viral_caption": (string) A descriptive, engaging text for the video overlay (English). Length: 15-30 words. It should be slightly more detailed to capture full context.
    - "viral_reason": (string) A brief explanation of why this specific clip has viral potential.
    
    IMPORTANT:
    1. Timestamps MUST be simple numbers (e.g. 10.5). Do NOT use leading zeros.
    2. Duration of each clip MUST be > {min_duration} seconds. LONG clips (up to 90s) are allowed and encouraged if the viral moment requires it. Don't cut them short arbitrarily.
    3. ABSOLUTE LIMIT: The video is approximately {video_duration} seconds long.
       - Focus your search from {start_time_offset} seconds to {video_duration} seconds.
       - DO NOT select clips before {start_time_offset} seconds (unless they are absolutely critical context).
       - ALL "start_time" and "end_time" MUST be less than {video_duration}.
    """

    try:
        response = client.models.generate_content(
            model=MODEL_ID,
            contents=[
                types.Content(
                    role="user",
                    parts=[
                        types.Part.from_uri(
                            file_uri=file_obj.uri,
                            mime_type=file_obj.mime_type
                        ),
                        types.Part.from_text(text=f"Find {target_clips} NEW viral clips in this video, specifically starting from {start_time_offset} seconds onwards.")
                    ]
                )
            ],
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                response_mime_type="application/json",
                temperature=0.85, # Higher temp for fresh topics
            )
        )
        return response.text
    except Exception as e:
        print(f"AI Analysis Failed: {e}")
        sys.exit(1)

def parse_json_response(response_text):
    try:
        cleaned_text = response_text.strip()
        if cleaned_text.startswith("```json"):
            cleaned_text = cleaned_text[7:]
        if cleaned_text.endswith("```"):
            cleaned_text = cleaned_text[:-3]
        
        cleaned_text = re.sub(r'\b0+(\d)', r'\1', cleaned_text)
        
        clips = json.loads(cleaned_text)
        return clips
    except json.JSONDecodeError as e:
        print(f"Failed to parse JSON response: {e}")
        print(f"Raw response: {response_text}")
        sys.exit(1)

def generate_report(clips_data, output_dir, video_path):
    report_path = os.path.join(output_dir, "CLIPS_REPORT.md")
    video_name = os.path.basename(video_path)
    
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(f"# Viral Clips Report (En-US)\n")
        f.write(f"**Source Video**: `{video_name}`\n")
        f.write(f"**Date**: {time.strftime('%Y-%m-%d %H:%M:%S')}\n\n")
        f.write("---\n\n")
        
        for i, clip in enumerate(clips_data):
            desc = clip.get("description", "clip")
            caption = clip.get("viral_caption", "N/A")
            reason = clip.get("viral_reason", "N/A")
            start = float(clip.get("start_time", 0))
            end = float(clip.get("end_time", 0))
            duration = end - start
            
            clean_desc = "".join([c for c in desc.replace(" ", "_").lower() if c.isalnum() or c in ('_', '-')])
            filename = f"clip_{i+1:02d}_{clean_desc}.mp4"
            
            f.write(f"## Clip {i+1}: {desc}\n\n")
            f.write(f"- **File**: `{filename}`\n")
            f.write(f"- **Viral Hook**: \"{caption}\"\n")
            f.write(f"- **Viral Potential**: *{reason}*\n")
            f.write(f"- **Time**: {start:.2f}s - {end:.2f}s\n")
            f.write(f"- **Duration**: {duration:.2f}s\n\n")
            f.write("---\n\n")
            
    print(f"Report generated: {report_path}")

def process_clips(video_path, clips_data, output_dir, use_qsv=False):
    print(f"Found {len(clips_data)} clips. Processing (QSV Accelerated: {use_qsv})...")
    
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    
    for i, clip_info in enumerate(clips_data):
        start = float(clip_info.get("start_time", 0))
        end = float(clip_info.get("end_time", 0))
        duration = end - start
        
        desc = clip_info.get("description", "clip").replace(" ", "_").lower()
        desc = "".join([c for c in desc if c.isalnum() or c in ('_', '-')])
        output_filename = os.path.join(output_dir, f"clip_{i+1:02d}_{desc}.mp4")
        
        print(f"Processing Clip {i+1}: {start:.1f}s - {end:.1f}s")
        
        # FFmpeg Command Construction
        # -ss before -i is fast seek. accurate enough for typical MP4s if we re-encode.
        
        cmd = [
            ffmpeg_exe,
            "-ss", str(start),
            "-i", video_path,
            "-t", str(duration),
            "-c:a", "aac",      # Audio codec standard
            "-strict", "experimental",
            "-y",               # Overwrite
            "-loglevel", "error"
        ]
        
        if use_qsv:
            # Intel QuickSync params
            # Note: global_quality is a standard control for QSV (like CRF for x264)
            # 20-25 is good.
            cmd.extend([
                "-c:v", "h264_qsv",
                "-global_quality", "22",
                "-preset", "medium" 
            ])
        else:
            # Fallback / Pure CPU FFmpeg (Faster than MoviePy)
            # preset 'veryfast' gives great speed with decent quality for social
            cmd.extend([
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-crf", "23"
            ])
            
        cmd.append(output_filename)
        
        try:
            subprocess.run(cmd, check=True)
            print(f"  -> Saved: {output_filename}")
        except subprocess.CalledProcessError as e:
            print(f"  -> Error processing clip {i+1}: {e}")
            if use_qsv:
                print("  -> QSV failed. Consider running without --qsv.")
                sys.exit(1)

    generate_report(clips_data, output_dir, video_path)
    print("\nAll clips processed successfully!")

# 3. Main Entry Point

def main():
    parser = argparse.ArgumentParser(description="AI Video Clipper")
    parser.add_argument("video_path", help="Path to the input video file")
    parser.add_argument("--clips", type=int, default=10, help="Number of clips")
    parser.add_argument("--min-duration", type=int, default=20, help="Min duration")
    parser.add_argument("--output", help="Custom output directory")
    parser.add_argument("--start-time", type=float, default=0, help="Start analysis from this timestamp (seconds)")
    parser.add_argument("--duration", type=float, help="Manually override video duration (seconds)")
    parser.add_argument("--qsv", action="store_true", help="Enable Intel QSV Hardware Acceleration")
    
    args = parser.parse_args()
    
    output_dir = setup_directories(args.video_path, custom_folder=args.output)
    
    print("--- Step 1: Uploading Video ---")
    file_obj = upload_video(args.video_path)
    
    print("--- Step 2: Processing Video ---")
    active_file = wait_for_processing(file_obj)
    
    # Check duration override
    video_duration = args.duration if args.duration else get_video_duration(args.video_path)
    print(f"Using Duration: {video_duration:.2f}s (Start Time: {args.start_time}s)")

    print("--- Step 3: AI Analysis ---")
    print(f"Requesting {args.clips} clips (min {args.min_duration}s)...")
    
    # Pass start_time and duration to analysis
    json_response = analyze_video_for_clips(active_file, args.video_path, target_clips=args.clips, min_duration=args.min_duration, start_time_offset=args.start_time, override_duration=video_duration)
    clips = parse_json_response(json_response)
    
    print(f"--- Step 4: Cutting Clips (Mode: {'QSV' if args.qsv else 'CPU-FFmpeg'}) ---")
    process_clips(args.video_path, clips, output_dir, use_qsv=args.qsv)

    print("Done.")

if __name__ == "__main__":
    main()

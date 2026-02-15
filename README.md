# 🎬 AI Video Clipper

An AI-powered tool that automatically identifies and extracts the most viral-worthy moments from long-form videos. Built with **Google Gemini 3 Pro** for intelligent video analysis and **FFmpeg** for high-quality clip extraction.

## ✨ Features

- **AI-Powered Analysis** — Uses Google Gemini 3 Pro's multimodal capabilities to watch and analyze entire videos
- **Smart Clip Detection** — Identifies the most engaging, dramatic, or funny moments that have viral potential
- **Customizable Output** — Control the number of clips, minimum duration, and analysis focus
- **Hardware Acceleration** — Intel QSV support for fast video encoding
- **Detailed Reports** — Generates a Markdown report with viral hooks, captions, timestamps, and viral potential analysis for each clip
- **Flexible Duration** — Set a minimum clip duration while allowing the AI to capture longer moments when needed
- **Start Time Offset** — Analyze specific portions of a video by setting a start time
- **Duration Override** — Manually specify video duration for accurate full-video analysis

## 📋 Requirements

- **Python 3.10+**
- **Google API Key** — with access to the Gemini API
- **FFmpeg** — bundled via `imageio-ffmpeg` (no manual install needed)
- **Intel QSV** *(optional)* — for hardware-accelerated encoding

## 🚀 Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/ai-video-clipper.git
   cd ai-video-clipper
   ```

2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Configure your API key:**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and add your Google API Key:
   ```
   GOOGLE_API_KEY=your_google_api_key_here
   ```

## 📖 Usage

### Basic Usage

```bash
python main.py video.mp4
```

This will analyze the video and extract **10 clips** (default) with a minimum duration of **20 seconds**.

### Custom Number of Clips

```bash
python main.py video.mp4 --clips 25
```

### Set Minimum Clip Duration

```bash
python main.py video.mp4 --clips 25 --min-duration 15
```

### Enable Intel QSV Hardware Acceleration

```bash
python main.py video.mp4 --clips 25 --min-duration 15 --qsv
```

### Analyze from a Specific Timestamp

Skip the first 10 minutes (600 seconds) of the video:

```bash
python main.py video.mp4 --clips 15 --start-time 600
```

### Override Video Duration

For very long videos where auto-detection might fail, manually specify the duration:

```bash
python main.py video.mp4 --clips 25 --duration 4494
```

### Custom Output Directory

```bash
python main.py video.mp4 --clips 25 --output my_clips_folder
```

### Full Example (All Options)

```bash
python main.py podcast_ep7.mp4 --clips 25 --min-duration 15 --qsv --start-time 0 --duration 4494 --output best_clips
```

## ⚙️ Command Line Arguments

| Argument | Type | Default | Description |
|---|---|---|---|
| `video_path` | positional | *required* | Path to the input video file |
| `--clips` | int | `10` | Number of clips to extract |
| `--min-duration` | int | `20` | Minimum clip duration in seconds |
| `--output` | string | auto | Custom output directory name |
| `--start-time` | float | `0` | Start analysis from this timestamp (seconds) |
| `--duration` | float | auto | Manually override video duration (seconds) |
| `--qsv` | flag | `false` | Enable Intel QSV hardware acceleration |

## 📁 Output Structure

For each video processed, the tool creates a dedicated output directory:

```
processed_clips_video_name/
├── clip_01_dramatic_confession.mp4
├── clip_02_funny_reaction.mp4
├── clip_03_heated_argument.mp4
├── ...
└── CLIPS_REPORT.md
```

### Report Format (`CLIPS_REPORT.md`)

The report contains detailed information for each clip:

```markdown
## Clip 1: Dramatic confession

- **File**: `clip_01_dramatic_confession.mp4`
- **Viral Hook**: "She finally reveals the truth about what happened last summer"
- **Viral Potential**: *Confession content performs well; viewers love dramatic reveals*
- **Time**: 245.00s - 285.00s
- **Duration**: 40.00s
```

## 🏗️ How It Works

```
┌──────────────────────────────────────────────────────┐
│                    AI VIDEO CLIPPER                   │
├──────────────────────────────────────────────────────┤
│                                                      │
│  1. UPLOAD        Video → Gemini File API            │
│                                                      │
│  2. PROCESS       Wait for Gemini to process video   │
│                                                      │
│  3. ANALYZE       Gemini 3 Pro watches the ENTIRE    │
│                   video and identifies viral moments  │
│                                                      │
│  4. PARSE         AI returns JSON with timestamps,   │
│                   descriptions, captions & reasons    │
│                                                      │
│  5. CUT           FFmpeg extracts each clip from     │
│                   the source video (QSV optional)     │
│                                                      │
│  6. REPORT        Markdown report generated with     │
│                   all clip details for review         │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Architecture

| Component | Technology | Purpose |
|---|---|---|
| Video Analysis | Google Gemini 3 Pro | AI watches and identifies viral moments |
| Video Cutting | FFmpeg (via imageio-ffmpeg) | Extract clips with precise timestamps |
| HW Acceleration | Intel QSV (h264_qsv) | Fast encoding on Intel GPUs |
| Report Generation | Python | Markdown report with clip metadata |
| Configuration | python-dotenv | Secure API key management |

## 🔧 Customizing the AI Prompt

The AI analysis prompt is located in `main.py` inside the `analyze_video_for_clips()` function. You can modify the `INSTRUCTION` line to change what the AI looks for:

```python
# Current default:
INSTRUCTION: Focus on EVERYTHING viral-worthy. Drama, emotions, funny moments...

# Example customizations:
INSTRUCTION: Focus on "Sophie Rain" - she is the main character...
INSTRUCTION: Focus on FUNNY, RELATABLE, and SHAREABLE moments...
INSTRUCTION: This is a PODCAST. Focus on interesting stories, huge confessions...
```

## 📝 Caption Style

All generated captions follow these rules:
- Written in **third person** ("She bought a car", not "I bought a car")
- Designed as **fan account style** reporting
- **15-30 words** for optimal TikTok text overlay length
- **English** (US audience target)

## ⚠️ Limitations

- **File Size**: Google Gemini API has a **2GB upload limit**. For larger files, consider trimming or compressing the video first.
- **Duration Detection**: For very long videos (>30min), use the `--duration` flag to manually specify the duration for accurate analysis.
- **API Costs**: Each video analysis uses the Gemini API, which may incur costs depending on your plan.

## 📄 License

MIT License — See [LICENSE](LICENSE) for details.

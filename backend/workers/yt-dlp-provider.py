#!/usr/bin/env python3
"""
YouTube Transcript Provider with yt-dlp Fallback
================================================

Hybrid approach for extracting YouTube transcripts and metadata:
1. Try youtube-transcript-api (fast, no cookies needed)
2. Get metadata and thumbnail via yt-dlp (always)
3. If step 1 failed, try full yt-dlp extraction with optional cookies

Output: JSON to stdout with transcript, metadata, and thumbnail info
Files: Creates {download_dir}/{videoid}/ folder with info.json, thumbnail, and transcript

Usage:
    python yt-dlp-provider.py <youtube_url> [cookies_path] [download_dir]
    
    cookies_path: Path to cookies.txt file (empty string "" if not available)
    download_dir: Base directory for downloads (default: /app/backend/yt-dlp/downloads)

Author: AI Summaries Library
Created: 2026-02-21
Updated: 2026-02-21 - Fixed argument handling, added folder creation, metadata extraction
"""

import sys
import json
import re
import os
import subprocess
from pathlib import Path
from typing import Optional, Dict, Any, List

# Configuration
DEFAULT_DOWNLOAD_DIR = "/app/backend/yt-dlp/downloads"
DEFAULT_COOKIES_PATH = "/app/backend/yt-dlp/cookies/cookies.txt"
YT_DLP_BIN = "yt-dlp"

# Optional proxy manager import - fails gracefully if not available
PROXY_AVAILABLE = False
try:
    from proxy_manager import ProxyManager, ProxyConfig, fetch_with_proxy_rotation
    PROXY_AVAILABLE = True
except ImportError:
    # proxy_manager.py not available, proxy features disabled
    pass

# Debug logging to stderr (so it doesn't interfere with JSON stdout)
def debug_log(component: str, message: str, data: dict = None):
    """Log debug messages to stderr in JSON format (only when DEBUG_MODE=true)."""
    if os.getenv('DEBUG_MODE', 'false').lower() != 'true':
        return
    log_entry = {
        "component": component,
        "message": message
    }
    if data:
        log_entry["data"] = data
    print(f"[DEBUG] {json.dumps(log_entry)}", file=sys.stderr)


def get_proxy_url_for_ytdlp() -> Optional[str]:
    """
    Get a single proxy URL for yt-dlp subprocess calls.

    Returns the first available proxy from the pool, or None if:
    - proxy_manager module is not available, OR
    - YT_DLP_PROXY_ENABLED environment variable is not 'true'

    Returns:
        Proxy URL string like "http://1.2.3.4:8080" or None
    """
    if not PROXY_AVAILABLE:
        return None

    if os.getenv('YT_DLP_PROXY_ENABLED', 'false').lower() != 'true':
        return None

    try:
        config = ProxyConfig.from_env()
        manager = ProxyManager(config)
        proxy = manager.get_next_proxy()
        if proxy:
            proxy_url = f"http://{proxy}"
            debug_log("PROXY_HELPER", f"Selected proxy for yt-dlp", {"proxy": proxy_url})
            return proxy_url
    except Exception as e:
        debug_log("PROXY_HELPER", f"Failed to get proxy for yt-dlp", {"error": str(e)})

    return None


def extract_video_id(url: str) -> Optional[str]:
    """
    Extract video ID from YouTube URL.
    
    Supports multiple URL formats:
    - https://www.youtube.com/watch?v=VIDEO_ID
    - https://youtu.be/VIDEO_ID
    - https://www.youtube.com/embed/VIDEO_ID
    - https://www.youtube.com/v/VIDEO_ID
    """
    patterns = [
        r'(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})',
        r'^([a-zA-Z0-9_-]{11})$'
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def format_timestamp(seconds: float) -> str:
    """
    Format seconds as [HH:MM:SS] or [MM:SS] timestamp.
    
    Args:
        seconds: Time in seconds (can be float)
        
    Returns:
        Formatted timestamp string like [00:05:30] or [05:30]
    """
    total_seconds = int(seconds)
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    secs = total_seconds % 60
    
    if hours > 0:
        return f"[{hours:02d}:{minutes:02d}:{secs:02d}]"
    else:
        return f"[{minutes:02d}:{secs:02d}]"


def normalize_transcript(transcript_with_timestamps: str) -> str:
    """
    Remove timestamps from transcript for normalized version.
    
    Args:
        transcript_with_timestamps: Transcript with [HH:MM:SS] format
        
    Returns:
        Clean transcript without timestamps
    """
    lines = transcript_with_timestamps.split('\n')
    normalized_lines = []
    
    for line in lines:
        trimmed_line = line.strip()
        if not trimmed_line:
            continue
        
        # Check if line starts with timestamp pattern [HH:MM:SS] or [MM:SS]
        timestamp_match = re.match(r'^\[\d+:\d+(?::\d+)?\]', trimmed_line)
        if timestamp_match:
            # Extract content after timestamp
            content = re.sub(r'^\[\d+:\d+(?::\d+)?\]\s*', '', trimmed_line)
            if content:
                normalized_lines.append(content)
        else:
            # Line without timestamp, add as-is
            normalized_lines.append(trimmed_line)
    
    # Join lines with spaces and clean up multiple spaces
    return re.sub(r'\s+', ' ', ' '.join(normalized_lines)).strip()


def get_transcript_python(video_id: str) -> Dict[str, Any]:
    """
    Try to get transcript using youtube-transcript-api.

    This is the fast method that doesn't require cookies.
    Supports proxy rotation if enabled via environment variables.

    Args:
        video_id: YouTube video ID

    Returns:
        Dict with success status and transcript data or error
    """
    debug_log("PYTHON_TRANSCRIPT", "Starting youtube-transcript-api extraction", {
        "video_id": video_id,
        "proxy_available": PROXY_AVAILABLE,
        "proxy_enabled": os.getenv('YT_DLP_PROXY_ENABLED', 'false').lower() == 'true'
    })

    # Check if proxy rotation is enabled
    proxy_enabled = os.getenv('YT_DLP_PROXY_ENABLED', 'false').lower() == 'true'

    if PROXY_AVAILABLE and proxy_enabled:
        debug_log("PYTHON_TRANSCRIPT", "Using proxy rotation for transcript fetch")
        return get_transcript_with_proxy(video_id)

    # Original direct connection behavior
    return get_transcript_direct(video_id)


def get_transcript_direct(video_id: str) -> Dict[str, Any]:
    """
    Get transcript using direct connection (no proxy).

    Args:
        video_id: YouTube video ID

    Returns:
        Dict with success status and transcript data or error
    """
    debug_log("PYTHON_TRANSCRIPT", "Using direct connection (no proxy)", {"video_id": video_id})

    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        from youtube_transcript_api._errors import TranscriptsDisabled, NoTranscriptFound, VideoUnavailable

        # Create API instance (new v1.x API)
        ytt_api = YouTubeTranscriptApi()

        # Fetch transcript with language fallback
        # Try: en (English) -> en-auto (auto-generated English) -> any available
        transcript = None
        languages_tried = []

        for lang in ['en', 'en-auto', None]:
            try:
                if lang:
                    transcript = ytt_api.fetch(video_id, languages=[lang])
                    debug_log("PYTHON_TRANSCRIPT", f"Successfully fetched transcript with language: {lang}")
                    break
                else:
                    # Last resort: get any available transcript
                    transcript = ytt_api.fetch(video_id)
                    debug_log("PYTHON_TRANSCRIPT", "Successfully fetched transcript with any language")
                    break
            except NoTranscriptFound:
                languages_tried.append(lang if lang else 'any')
                debug_log("PYTHON_TRANSCRIPT", f"No transcript found for language: {lang if lang else 'any'}")
                continue
            except Exception as e:
                languages_tried.append(f"{lang if lang else 'any'}: {str(e)}")
                debug_log("PYTHON_TRANSCRIPT", f"Error for language {lang if lang else 'any'}: {str(e)}")
                continue

        if not transcript:
            error_msg = f"No transcript found via youtube-transcript-api. Languages tried: {', '.join(languages_tried)}"
            debug_log("PYTHON_TRANSCRIPT", error_msg)
            return {
                "success": False,
                "error": error_msg,
                "method": "direct"
            }

        # Build transcript with timestamps
        text_out = ""
        for snippet in transcript:
            timestamp = format_timestamp(snippet.start)
            text = snippet.text.replace('\n', ' ').strip()
            text_out += f"{timestamp} {text}\n"

        debug_log("PYTHON_TRANSCRIPT", "Transcript extraction successful", {
            "transcript_length": len(text_out),
            "snippet_count": len(list(transcript)) if hasattr(transcript, '__iter__') else 'unknown'
        })

        return {
            "success": True,
            "transcript": text_out.strip(),
            "method": "direct"
        }

    except ImportError as e:
        debug_log("PYTHON_TRANSCRIPT", f"Import error: {str(e)}")
        return {
            "success": False,
            "error": f"Import error: {str(e)}. Please install youtube-transcript-api",
            "method": "direct"
        }
    except TranscriptsDisabled:
        debug_log("PYTHON_TRANSCRIPT", "Transcripts are disabled for this video")
        return {
            "success": False,
            "error": "Transcripts are disabled for this video",
            "method": "direct"
        }
    except VideoUnavailable:
        debug_log("PYTHON_TRANSCRIPT", "Video is unavailable")
        return {
            "success": False,
            "error": "Video is unavailable or the ID is wrong",
            "method": "direct"
        }
    except Exception as e:
        debug_log("PYTHON_TRANSCRIPT", f"Unexpected error: {str(e)}")
        return {
            "success": False,
            "error": f"youtube-transcript-api error: {str(e)}",
            "method": "direct"
        }


def get_transcript_with_proxy(video_id: str) -> Dict[str, Any]:
    """
    Get transcript using proxy rotation.

    Args:
        video_id: YouTube video ID

    Returns:
        Dict with success status and transcript data or error
    """
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        from youtube_transcript_api._errors import TranscriptsDisabled, NoTranscriptFound, VideoUnavailable
        from youtube_transcript_api.proxies import GenericProxyConfig

        proxy_config = ProxyConfig.from_env()

        def fetch_func(vid: str, proxy_url: Optional[str] = None):
            """Inner function to fetch transcript with optional proxy."""
            if proxy_url:
                api = YouTubeTranscriptApi(proxy_config=GenericProxyConfig(
                    http_url=f"http://{proxy_url}",
                    https_url=f"http://{proxy_url}"
                ))
            else:
                api = YouTubeTranscriptApi()
            return api.fetch(vid)

        # Use proxy manager to fetch with rotation
        result = fetch_with_proxy_rotation(
            video_id,
            fetch_func,
            languages=['en', 'en-auto', None],
            config=proxy_config
        )

        if not result.get("success"):
            debug_log("PYTHON_TRANSCRIPT", "Proxy rotation failed", {"error": result.get("error")})
            return {
                "success": False,
                "error": result.get("error", "Proxy rotation failed"),
                "method": "proxy_failed"
            }

        # Build transcript with timestamps
        transcript = result["transcript"]
        text_out = ""
        for snippet in transcript:
            timestamp = format_timestamp(snippet.start)
            text = snippet.text.replace('\n', ' ').strip()
            text_out += f"{timestamp} {text}\n"

        debug_log("PYTHON_TRANSCRIPT", "Transcript extraction successful with proxy", {
            "transcript_length": len(text_out),
            "proxy_used": result.get("proxy_used"),
            "snippet_count": len(list(transcript)) if hasattr(transcript, '__iter__') else 'unknown'
        })

        return {
            "success": True,
            "transcript": text_out.strip(),
            "method": "proxy",
            "proxy_used": result.get("proxy_used")
        }

    except TranscriptsDisabled:
        debug_log("PYTHON_TRANSCRIPT", "Transcripts are disabled for this video")
        return {
            "success": False,
            "error": "Transcripts are disabled for this video",
            "method": "proxy"
        }
    except VideoUnavailable:
        debug_log("PYTHON_TRANSCRIPT", "Video is unavailable")
        return {
            "success": False,
            "error": "Video is unavailable or the ID is wrong",
            "method": "proxy"
        }
    except Exception as e:
        debug_log("PYTHON_TRANSCRIPT", f"Proxy method error: {str(e)}")
        # Fall back to direct connection on any error
        debug_log("PYTHON_TRANSCRIPT", "Falling back to direct connection")
        return get_transcript_direct(video_id)
        return {
            "success": False,
            "error": f"youtube-transcript-api error: {str(e)}"
        }


def download_metadata_and_files(url: str, video_id: str, video_dir: Path, cookies_path: Optional[str] = None, successful_proxy: Optional[str] = None) -> Dict[str, Any]:
    """
    Download metadata (info.json), thumbnail, and optionally subtitles using yt-dlp.

    This function ALWAYS runs to ensure folder is created with all available files.

    Args:
        url: YouTube video URL
        video_id: YouTube video ID
        video_dir: Path to video directory (already created)
        cookies_path: Optional path to cookies.txt file
        successful_proxy: Optional proxy IP:port that succeeded for transcript fetch (will be reused)

    Returns:
        Dict with success status and metadata or error
    """
    debug_log("YT_DLP_DOWNLOAD", "Starting yt-dlp download of metadata and files", {
        "url": url,
        "video_id": video_id,
        "video_dir": str(video_dir),
        "cookies_path": cookies_path,
        "cookies_exists": os.path.exists(cookies_path) if cookies_path else False
    })
    
    try:
        output_template = str(video_dir / "%(id)s.%(ext)s")
        
        # Build yt-dlp command to download metadata and thumbnail
        cmd = [
            YT_DLP_BIN,
            "--no-progress",
            "--no-warnings",
            "--skip-download",           # Don't download video/audio
            "--write-info-json",         # Download info.json
            "--write-thumbnail",         # Download thumbnail
            "-o", output_template,
            url
        ]
        
        # Add cookies if available and exists
        cookies_used = False
        if cookies_path and cookies_path.strip() and os.path.exists(cookies_path):
            cmd.extend(["--cookies", cookies_path])
            cookies_used = True
            debug_log("YT_DLP_DOWNLOAD", f"Using cookies file: {cookies_path}")
        else:
            debug_log("YT_DLP_DOWNLOAD", "No cookies file available")

        # Add proxy if available
        if successful_proxy:
            # Reuse the proxy that succeeded for transcript fetch
            proxy_url = f"http://{successful_proxy}"
            cmd.extend(["--proxy", proxy_url])
            debug_log("YT_DLP_DOWNLOAD", f"Reusing successful proxy: {proxy_url}")
        else:
            # Get a new proxy from the pool (original behavior)
            proxy_url = get_proxy_url_for_ytdlp()
            if proxy_url:
                cmd.extend(["--proxy", proxy_url])
                debug_log("YT_DLP_DOWNLOAD", f"Using proxy from pool: {proxy_url}")
            else:
                debug_log("YT_DLP_DOWNLOAD", "No proxy configured or proxy disabled")

        debug_log("YT_DLP_DOWNLOAD", f"Running command: {' '.join(cmd)}")
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        
        debug_log("YT_DLP_DOWNLOAD", f"Command completed", {
            "return_code": result.returncode,
            "stdout_length": len(result.stdout),
            "stderr_length": len(result.stderr),
            "stderr_preview": result.stderr[:500] if result.stderr else "",
            "files_in_dir": os.listdir(video_dir) if video_dir.exists() else []
        })
        
        # Check for files regardless of return code (yt-dlp may report non-zero but still download files)
        info_file = video_dir / f"{video_id}.info.json"
        thumbnail_file = None
        
        # Find thumbnail file (could be .webp, .jpg, .png)
        for ext in [".webp", ".jpg", ".png", ".jpeg"]:
            thumb_path = video_dir / f"{video_id}{ext}"
            if thumb_path.exists():
                thumbnail_file = str(thumb_path)
                debug_log("YT_DLP_DOWNLOAD", f"Found thumbnail: {thumb_path}")
                break
        
        # Read info.json for metadata
        title = ""
        channel = ""
        description = ""
        thumbnail_url = ""
        duration = 0
        
        if info_file.exists():
            debug_log("YT_DLP_DOWNLOAD", f"Reading info.json: {info_file}")
            try:
                with open(info_file, "r", encoding="utf-8") as f:
                    info = json.load(f)
                title = info.get("title", "")
                channel = info.get("channel") or info.get("uploader") or info.get("channel_id", "")
                description = info.get("description", "")
                thumbnail_url = info.get("thumbnail", "") or (info.get("thumbnails", [{}])[0].get("url", "") if info.get("thumbnails") else "")
                duration = info.get("duration", 0)
                
                debug_log("YT_DLP_DOWNLOAD", "Successfully read metadata from info.json", {
                    "title": title[:50] + "..." if len(title) > 50 else title,
                    "channel": channel,
                    "description_length": len(description) if description else 0,
                    "thumbnail_url": thumbnail_url[:80] if thumbnail_url else "none",
                    "duration": duration
                })
            except Exception as e:
                debug_log("YT_DLP_DOWNLOAD", f"Failed to read info.json: {str(e)}")
        else:
            debug_log("YT_DLP_DOWNLOAD", f"info.json not found at {info_file}")
        
        # If no title from info.json, try --dump-json as fallback
        if not title:
            debug_log("YT_DLP_DOWNLOAD", "No title from info.json, trying --dump-json fallback")
            dump_result = get_metadata_dump_json(url, cookies_path)
            if dump_result.get("success"):
                title = dump_result.get("title", "")
                channel = dump_result.get("channel", "")
                description = dump_result.get("description", "")
                thumbnail_url = dump_result.get("thumbnail", "")
                duration = dump_result.get("duration", 0)
        
        return {
            "success": True,
            "title": title,
            "channel": channel,
            "description": description,
            "thumbnail_url": thumbnail_url,
            "thumbnail_file": thumbnail_file,
            "duration": duration,
            "info_file": str(info_file) if info_file.exists() else None,
            "cookies_used": cookies_used
        }
        
    except subprocess.TimeoutExpired:
        debug_log("YT_DLP_DOWNLOAD", "yt-dlp download timeout")
        return {
            "success": False,
            "error": "yt-dlp download timeout"
        }
    except FileNotFoundError:
        debug_log("YT_DLP_DOWNLOAD", "yt-dlp binary not found")
        return {
            "success": False,
            "error": "yt-dlp binary not found. Please install yt-dlp"
        }
    except Exception as e:
        debug_log("YT_DLP_DOWNLOAD", f"Unexpected error: {str(e)}")
        return {
            "success": False,
            "error": f"yt-dlp download error: {str(e)}"
        }


def get_metadata_dump_json(url: str, cookies_path: Optional[str] = None, successful_proxy: Optional[str] = None) -> Dict[str, Any]:
    """
    Get video metadata using yt-dlp with --dump-json (fallback method).

    Args:
        url: YouTube video URL
        cookies_path: Optional path to cookies.txt file
        successful_proxy: Optional proxy IP:port that succeeded for transcript fetch (will be reused)

    Returns:
        Dict with success status and metadata or error
    """
    debug_log("YT_DLP_DUMP", "Starting --dump-json metadata extraction", {"url": url})
    
    try:
        cmd = [
            YT_DLP_BIN,
            "--no-progress",
            "--no-warnings",
            "--skip-download",
            "--dump-json",
            url
        ]

        if cookies_path and cookies_path.strip() and os.path.exists(cookies_path):
            cmd.extend(["--cookies", cookies_path])

        # Add proxy if available
        if successful_proxy:
            # Reuse the proxy that succeeded for transcript fetch
            proxy_url = f"http://{successful_proxy}"
            cmd.extend(["--proxy", proxy_url])
        else:
            # Get a new proxy from the pool (original behavior)
            proxy_url = get_proxy_url_for_ytdlp()
            if proxy_url:
                cmd.extend(["--proxy", proxy_url])

        debug_log("YT_DLP_DUMP", f"Running command: {' '.join(cmd)}")
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        
        if result.returncode != 0:
            debug_log("YT_DLP_DUMP", f"yt-dlp --dump-json failed: {result.stderr[:200]}")
            return {
                "success": False,
                "error": f"yt-dlp --dump-json failed: {result.stderr.strip()}"
            }
        
        if not result.stdout or result.stdout.strip() == "":
            debug_log("YT_DLP_DUMP", "No output from yt-dlp --dump-json")
            return {
                "success": False,
                "error": "yt-dlp --dump-json returned empty output"
            }
        
        info = json.loads(result.stdout)
        
        return {
            "success": True,
            "title": info.get("title", ""),
            "channel": info.get("channel") or info.get("uploader") or info.get("channel_id", ""),
            "description": info.get("description", ""),
            "thumbnail": info.get("thumbnail", "") or (info.get("thumbnails", [{}])[0].get("url", "") if info.get("thumbnails") else ""),
            "duration": info.get("duration", 0)
        }
        
    except Exception as e:
        debug_log("YT_DLP_DUMP", f"Error: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }


def get_transcript_ytdlp(url: str, video_id: str, video_dir: Path, cookies_path: Optional[str] = None, successful_proxy: Optional[str] = None) -> Dict[str, Any]:
    """
    Full yt-dlp extraction with subtitle download.

    This is the fallback method when youtube-transcript-api fails.
    Downloads subtitles along with metadata and thumbnail.

    Args:
        url: YouTube video URL
        video_id: YouTube video ID
        video_dir: Path to video directory (already created)
        cookies_path: Optional path to cookies.txt file
        successful_proxy: Optional proxy IP:port that succeeded for transcript fetch (will be reused)

    Returns:
        Dict with success status and all data or error
    """
    debug_log("YT_DLP_FULL", "Starting full yt-dlp extraction with subtitles", {
        "url": url,
        "video_id": video_id,
        "video_dir": str(video_dir),
        "cookies_path": cookies_path
    })
    
    try:
        output_template = str(video_dir / "%(id)s.%(ext)s")
        
        cmd = [
            YT_DLP_BIN,
            "--no-progress",
            "--no-warnings",
            "--skip-download",          # Don't download video
            "--write-info-json",        # Download info.json
            "--write-auto-sub",         # Download auto-generated subtitles
            "--write-thumbnail",        # Download thumbnail
            "--sub-lang", "en",
            "--sub-format", "srt",
            "-o", output_template,
            url
        ]
        
        # Add cookies if available
        cookies_used = False
        if cookies_path and cookies_path.strip() and os.path.exists(cookies_path):
            cmd.extend(["--cookies", cookies_path])
            cookies_used = True
            debug_log("YT_DLP_FULL", f"Using cookies file: {cookies_path}")

        # Add proxy if available
        if successful_proxy:
            # Reuse the proxy that succeeded for transcript fetch
            proxy_url = f"http://{successful_proxy}"
            cmd.extend(["--proxy", proxy_url])
            debug_log("YT_DLP_FULL", f"Reusing successful proxy: {proxy_url}")
        else:
            # Get a new proxy from the pool (original behavior)
            proxy_url = get_proxy_url_for_ytdlp()
            if proxy_url:
                cmd.extend(["--proxy", proxy_url])
                debug_log("YT_DLP_FULL", f"Using proxy from pool: {proxy_url}")

        debug_log("YT_DLP_FULL", f"Running command: {' '.join(cmd)}")
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        
        debug_log("YT_DLP_FULL", f"Command completed", {
            "return_code": result.returncode,
            "stdout_length": len(result.stdout),
            "stderr_length": len(result.stderr),
            "files_in_dir": os.listdir(video_dir) if video_dir.exists() else []
        })
        
        # Read subtitle file
        transcript = ""
        srt_file = video_dir / f"{video_id}.en.srt"
        vtt_file = video_dir / f"{video_id}.en.vtt"
        
        if srt_file.exists():
            debug_log("YT_DLP_FULL", f"Reading SRT file: {srt_file}")
            with open(srt_file, "r", encoding="utf-8", errors="replace") as f:
                srt_content = f.read()
            transcript = srt_to_timestamped(srt_content)
        elif vtt_file.exists():
            debug_log("YT_DLP_FULL", f"Reading VTT file: {vtt_file}")
            with open(vtt_file, "r", encoding="utf-8", errors="replace") as f:
                vtt_content = f.read()
            transcript = vtt_to_timestamped(vtt_content)
        else:
            debug_log("YT_DLP_FULL", "No subtitle file found")
            return {
                "success": False,
                "error": "No subtitle file downloaded by yt-dlp",
                "cookies_used": cookies_used
            }
        
        # Read info.json for metadata
        title = ""
        channel = ""
        description = ""
        thumbnail_file = ""
        
        info_file = video_dir / f"{video_id}.info.json"
        if info_file.exists():
            debug_log("YT_DLP_FULL", f"Reading info.json: {info_file}")
            with open(info_file, "r", encoding="utf-8") as f:
                info = json.load(f)
            title = info.get("title", "")
            channel = info.get("channel") or info.get("uploader", "")
            description = info.get("description", "")
            
            # Check for thumbnail (might have been downloaded)
            for ext in [".webp", ".jpg", ".png"]:
                thumb_path = video_dir / f"{video_id}{ext}"
                if thumb_path.exists():
                    thumbnail_file = str(thumb_path)
                    debug_log("YT_DLP_FULL", f"Found thumbnail: {thumb_path}")
                    break
        
        # Build transcript with timestamps
        transcript_with_timestamps = transcript
        normalized = normalize_transcript(transcript_with_timestamps)
        
        debug_log("YT_DLP_FULL", "Successfully extracted all data", {
            "transcript_length": len(transcript_with_timestamps),
            "title": title[:50] + "..." if len(title) > 50 else title,
            "channel": channel,
            "thumbnail_file": thumbnail_file,
            "method": "ytdlp_cookies" if cookies_used else "ytdlp"
        })
        
        return {
            "success": True,
            "transcript": transcript_with_timestamps,
            "transcript_normalized": normalized,
            "title": title,
            "channel": channel,
            "description": description,
            "thumbnail": thumbnail_file,
            "method": "ytdlp_cookies" if cookies_used else "ytdlp"
        }
        
    except subprocess.TimeoutExpired:
        debug_log("YT_DLP_FULL", "yt-dlp extraction timeout")
        return {
            "success": False,
            "error": "yt-dlp extraction timeout"
        }
    except FileNotFoundError:
        debug_log("YT_DLP_FULL", "yt-dlp binary not found")
        return {
            "success": False,
            "error": "yt-dlp binary not found. Please install yt-dlp"
        }
    except Exception as e:
        debug_log("YT_DLP_FULL", f"Unexpected error: {str(e)}")
        return {
            "success": False,
            "error": f"yt-dlp extraction error: {str(e)}"
        }


def srt_to_timestamped(srt_content: str) -> str:
    """
    Convert SRT subtitle format to timestamped transcript.
    
    SRT format:
        1
        00:00:05,000 --> 00:00:10,000
        Hello world
        
    Output:
        [00:05] Hello world
    """
    lines = srt_content.strip().split('\n')
    result = []
    current_text = []
    
    for line in lines:
        line = line.strip()
        
        # Skip sequence numbers
        if line.isdigit():
            continue
        
        # Parse timestamp line
        if '-->' in line:
            # Output previous text if any
            if current_text:
                result.append(' '.join(current_text))
                current_text = []
            
            # Parse start time from "00:00:05,000 --> 00:00:10,000"
            time_match = re.match(r'(\d{2}):(\d{2}):(\d{2}),\d{3}', line)
            if time_match:
                hours, mins, secs = int(time_match.group(1)), int(time_match.group(2)), int(time_match.group(3))
                total_secs = hours * 3600 + mins * 60 + secs
                timestamp = format_timestamp(total_secs)
                current_text.append(timestamp)
            continue
        
        # Skip empty lines
        if not line:
            if current_text:
                result.append(' '.join(current_text))
                current_text = []
            continue
        
        # Regular text line
        current_text.append(line)
    
    # Don't forget last segment
    if current_text:
        result.append(' '.join(current_text))
    
    return '\n'.join(result)


def vtt_to_timestamped(vtt_content: str) -> str:
    """
    Convert VTT subtitle format to timestamped transcript.
    
    VTT format:
        WEBVTT
        Kind: captions
        Language: en
        
        00:00:05.000 --> 00:00:10.000
        Hello world
        
    Output:
        [00:05] Hello world
    """
    lines = vtt_content.strip().split('\n')
    result = []
    current_text = []
    in_cue = False
    
    for line in lines:
        line = line.strip()
        
        # Skip WEBVTT header
        if line.startswith('WEBVTT') or line.startswith('Kind:') or line.startswith('Language:'):
            continue
        
        # Parse timestamp line
        if '-->' in line:
            in_cue = True
            # Output previous text if any
            if current_text:
                result.append(' '.join(current_text))
                current_text = []
            
            # Parse start time from "00:00:05.000 --> 00:00:10.000"
            time_match = re.match(r'(\d{2}):(\d{2}):(\d{2})\.\d{3}', line)
            if time_match:
                hours, mins, secs = int(time_match.group(1)), int(time_match.group(2)), int(time_match.group(3))
                total_secs = hours * 3600 + mins * 60 + secs
                timestamp = format_timestamp(total_secs)
                current_text.append(timestamp)
            continue
        
        # Skip empty lines
        if not line:
            if current_text:
                result.append(' '.join(current_text))
                current_text = []
            in_cue = False
            continue
        
        # Regular text line (only in cue)
        if in_cue:
            current_text.append(line)
    
    # Don't forget last segment
    if current_text:
        result.append(' '.join(current_text))
    
    return '\n'.join(result)


def get_transcript_hybrid(url: str, cookies_path: Optional[str] = None, download_dir: Optional[str] = None) -> Dict[str, Any]:
    """
    Main entry point - hybrid approach for transcript extraction.
    
    Workflow:
    1. Create video folder
    2. Try youtube-transcript-api (fast, no cookies)
    3. Always download metadata and files via yt-dlp
    4. If step 2 failed, try full yt-dlp extraction
    
    Args:
        url: YouTube video URL
        cookies_path: Optional path to cookies.txt for age-restricted videos (empty string if not available)
        download_dir: Directory to save files (default: /app/backend/yt-dlp/downloads)
        
    Returns:
        Dict with all extracted data
    """
    debug_log("HYBRID", "Starting hybrid transcript extraction", {
        "url": url,
        "cookies_path": cookies_path,
        "download_dir": download_dir
    })
    
    # Extract video ID
    video_id = extract_video_id(url)
    if not video_id:
        debug_log("HYBRID", "Failed to extract video ID from URL")
        return {
            "success": False,
            "error": "Could not extract video ID from URL",
            "transcript": "",
            "transcript_normalized": "",
            "title": "",
            "channel": "",
            "description": "",
            "thumbnail": "",
            "method": "failed"
        }
    
    debug_log("HYBRID", f"Extracted video ID: {video_id}")
    
    # Set defaults
    if not download_dir or not download_dir.strip():
        download_dir = DEFAULT_DOWNLOAD_DIR
    
    # Handle empty string cookies_path
    if not cookies_path or not cookies_path.strip():
        cookies_path = DEFAULT_COOKIES_PATH
        if not os.path.exists(cookies_path):
            debug_log("HYBRID", f"Default cookies path does not exist: {cookies_path}")
            cookies_path = None
        else:
            debug_log("HYBRID", f"Using default cookies path: {cookies_path}")
    
    # Create video directory
    video_dir = Path(download_dir) / video_id
    try:
        video_dir.mkdir(parents=True, exist_ok=True)
        debug_log("HYBRID", f"Created video directory: {video_dir}")
    except Exception as e:
        debug_log("HYBRID", f"Failed to create video directory: {str(e)}")
        return {
            "success": False,
            "error": f"Failed to create video directory: {str(e)}",
            "transcript": "",
            "transcript_normalized": "",
            "title": "",
            "channel": "",
            "description": "",
            "thumbnail": "",
            "method": "failed",
            "video_id": video_id
        }
    
    # Step 1: Try youtube-transcript-api
    debug_log("HYBRID", "Step 1: Trying youtube-transcript-api...")
    python_result = get_transcript_python(video_id)

    # Extract successful proxy if available
    successful_proxy = python_result.get("proxy_used")
    if successful_proxy:
        debug_log("HYBRID", f"Using successful proxy from transcript fetch: {successful_proxy}")

    # Step 2: Always download metadata and files via yt-dlp
    debug_log("HYBRID", "Step 2: Downloading metadata and files via yt-dlp...")
    metadata_result = download_metadata_and_files(url, video_id, video_dir, cookies_path, successful_proxy)
    
    # Initialize result
    result = {
        "success": False,
        "transcript": "",
        "transcript_normalized": "",
        "title": "",
        "channel": "",
        "description": "",
        "thumbnail": "",
        "thumbnail_url": "",
        "method": "failed",
        "video_id": video_id,
        "video_dir": str(video_dir)
    }
    
    # Add metadata from yt-dlp
    if metadata_result.get("success"):
        result["title"] = metadata_result.get("title", "")
        result["channel"] = metadata_result.get("channel", "")
        result["description"] = metadata_result.get("description", "")
        result["thumbnail"] = metadata_result.get("thumbnail_file", "")
        result["thumbnail_url"] = metadata_result.get("thumbnail_url", "")
        debug_log("HYBRID", "Metadata extraction successful", {
            "title": result["title"][:50] if result["title"] else "",
            "channel": result["channel"],
            "thumbnail_file": result["thumbnail"]
        })
    else:
        debug_log("HYBRID", "Metadata extraction FAILED", {
            "error": metadata_result.get("error", "Unknown error")
        })
    
    # If youtube-transcript-api succeeded
    if python_result.get("success"):
        debug_log("HYBRID", "youtube-transcript-api succeeded, using python_script method")
        result["success"] = True
        result["transcript"] = python_result["transcript"]
        result["transcript_normalized"] = normalize_transcript(python_result["transcript"])
        result["method"] = "python_script"
        
        # Save transcript to file
        transcript_file = video_dir / f"{video_id}.transcript.txt"
        try:
            with open(transcript_file, "w", encoding="utf-8") as f:
                f.write(python_result["transcript"])
            debug_log("HYBRID", f"Saved transcript to: {transcript_file}")
        except Exception as e:
            debug_log("HYBRID", f"Failed to save transcript file: {str(e)}")
        
        debug_log("HYBRID", "Final result prepared", {
            "method": result["method"],
            "transcript_length": len(result["transcript"]),
            "title_length": len(result["title"]),
            "channel": result["channel"],
            "video_dir": str(video_dir)
        })
        
        return result
    
    # Step 3: youtube-transcript-api failed, try full yt-dlp extraction
    debug_log("HYBRID", "Step 3: youtube-transcript-api failed, trying full yt-dlp extraction...")
    ytdlp_result = get_transcript_ytdlp(url, video_id, video_dir, cookies_path)
    
    if ytdlp_result.get("success"):
        debug_log("HYBRID", "Full yt-dlp extraction succeeded")
        return {
            "success": True,
            "transcript": ytdlp_result["transcript"],
            "transcript_normalized": ytdlp_result["transcript_normalized"],
            "title": ytdlp_result["title"],
            "channel": ytdlp_result["channel"],
            "description": ytdlp_result["description"],
            "thumbnail": ytdlp_result["thumbnail"],
            "thumbnail_url": ytdlp_result.get("thumbnail", ""),
            "method": ytdlp_result["method"],
            "video_id": video_id,
            "video_dir": str(video_dir)
        }
    
    # All methods failed
    debug_log("HYBRID", "All extraction methods failed", {
        "python_error": python_result.get("error"),
        "ytdlp_error": ytdlp_result.get("error")
    })
    
    return {
        "success": False,
        "error": f"All methods failed. Python: {python_result.get('error')}, yt-dlp: {ytdlp_result.get('error')}",
        "transcript": "",
        "transcript_normalized": "",
        "title": metadata_result.get("title", "") if metadata_result.get("success") else "",
        "channel": metadata_result.get("channel", "") if metadata_result.get("success") else "",
        "description": metadata_result.get("description", "") if metadata_result.get("success") else "",
        "thumbnail": metadata_result.get("thumbnail_file", "") if metadata_result.get("success") else "",
        "thumbnail_url": "",
        "method": "failed",
        "video_id": video_id,
        "video_dir": str(video_dir)
    }


def main():
    """Main entry point for CLI usage."""
    # Check arguments
    if len(sys.argv) < 2:
        print(json.dumps({
            "success": False,
            "error": "No URL provided. Usage: python yt-dlp-provider.py <youtube_url> [cookies_path] [download_dir]"
        }))
        sys.exit(1)
    
    url = sys.argv[1]
    cookies_path = sys.argv[2] if len(sys.argv) > 2 else None
    download_dir = sys.argv[3] if len(sys.argv) > 3 else None
    
    debug_log("MAIN", "Starting yt-dlp-provider", {
        "url": url,
        "cookies_path": cookies_path,
        "download_dir": download_dir,
        "argc": len(sys.argv)
    })
    
    # Run hybrid extraction
    result = get_transcript_hybrid(url, cookies_path, download_dir)
    
    # Output JSON to stdout
    print(json.dumps(result))
    sys.exit(0 if result.get("success") else 1)


if __name__ == "__main__":
    main()
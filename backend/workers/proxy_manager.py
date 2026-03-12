#!/usr/bin/env python3
"""
YouTube Transcript Proxy Manager
=================================

Modular proxy rotation system for youtube-transcript-api.
Supports both free (ProxyScrape) and paid proxy services.

This module is completely self-contained and can be safely deleted
if proxy functionality is not needed.

Usage:
    from proxy_manager import ProxyManager, ProxyConfig

    config = ProxyConfig.from_env()
    manager = ProxyManager(config)

    # Fetch transcript with proxy rotation
    def fetch_transcript(video_id, proxy_url=None):
        api = YouTubeTranscriptApi()
        if proxy_url:
            api = YouTubeTranscriptApi(proxy_config=GenericProxyConfig(
                http_url=f"http://{proxy_url}",
                https_url=f"http://{proxy_url}"
            ))
        return api.fetch(video_id, languages=['en'])

    transcript = manager.rotate_with_retry("VIDEO_ID", fetch_transcript)

Author: AI Summaries Library
Created: 2026-02-24
"""

import os
import sys
import json
import re
import time
import random
import requests
from typing import Optional, List, Callable, Dict, Any
from dataclasses import dataclass


def debug_log(component: str, message: str, data: dict = None):
    """Log debug messages to stderr in JSON format (only when DEBUG_MODE=true)."""
    if os.getenv('DEBUG_MODE', 'false').lower() != 'true':
        return
    log_entry = {"component": component, "message": message}
    if data:
        log_entry["data"] = data
    print(f"[DEBUG] {json.dumps(log_entry)}", file=sys.stderr)


def _is_valid_proxy_format(proxy: str) -> bool:
    """
    Validate proxy format matches IP:PORT pattern.

    Args:
        proxy: Proxy string to validate

    Returns:
        True if proxy matches valid IP:port format, False otherwise
    """
    if not proxy or len(proxy.strip()) == 0:
        return False

    proxy = proxy.strip()

    # Check for control characters or spaces
    if any(ord(c) < 32 or ord(c) == 127 or c.isspace() for c in proxy):
        return False

    # Match IP:PORT pattern (IPv4 only for simplicity)
    # Format: 1.2.3.4:8080
    ip_pattern = r'^((?:[0-9]{1,3}\.){3}[0-9]{1,3}):[0-9]{1,5}$'
    return bool(re.match(ip_pattern, proxy))


@dataclass
class ProxyConfig:
    """Configuration for proxy manager."""
    enabled: bool = False
    proxy_type: str = "free"  # 'free' or 'paid'
    min_pool_size: int = 3  # Minimum proxies before returning (increased from 1 for better reliability)
    pool_size: int = 20  # Target pool size for rotation
    max_test_attempts: int = 50  # Maximum proxies to test before giving up
    max_retries: int = 5
    min_backoff: int = 10
    max_backoff: int = 60
    paid_api_key: str = ""
    paid_endpoint: str = ""
    test_url: str = "http://httpbin.org/ip"
    test_timeout: int = 5
    # New config fields for improved proxy filtering
    test_youtube_directly: bool = True  # Test against YouTube instead of generic endpoint
    max_response_time: int = 5  # Maximum acceptable proxy response time in seconds
    blocked_ports: str = "3128,3129,8080,8888"  # Comma-separated list of ports to block
    enable_https_fallback: bool = True  # Enable HTTPS fallback test when robots.txt fails

    @classmethod
    def from_env(cls) -> 'ProxyConfig':
        """Create configuration from environment variables."""
        return cls(
            enabled=os.getenv('YT_DLP_PROXY_ENABLED', 'false').lower() == 'true',
            proxy_type=os.getenv('YT_DLP_PROXY_TYPE', 'free'),
            min_pool_size=int(os.getenv('YT_DLP_PROXY_MIN_POOL_SIZE', '3')),
            pool_size=int(os.getenv('YT_DLP_PROXY_POOL_SIZE', '20')),
            max_test_attempts=int(os.getenv('YT_DLP_PROXY_MAX_TEST_ATTEMPTS', '50')),
            max_retries=int(os.getenv('YT_DLP_PROXY_MAX_RETRIES', '5')),
            min_backoff=int(os.getenv('YT_DLP_PROXY_MIN_BACKOFF', '10')),
            max_backoff=int(os.getenv('YT_DLP_PROXY_MAX_BACKOFF', '60')),
            paid_api_key=os.getenv('YT_DLP_PROXY_PAID_API_KEY', ''),
            paid_endpoint=os.getenv('YT_DLP_PROXY_PAID_ENDPOINT', ''),
            test_url=os.getenv('YT_DLP_PROXY_TEST_URL', 'http://httpbin.org/ip'),
            test_timeout=int(os.getenv('YT_DLP_PROXY_TEST_TIMEOUT', '5')),
            # New config fields from environment
            test_youtube_directly=os.getenv('YT_DLP_PROXY_TEST_YOUTUBE_DIRECTLY', 'true').lower() == 'true',
            max_response_time=int(os.getenv('YT_DLP_PROXY_MAX_RESPONSE_TIME', '5')),
            blocked_ports=os.getenv('YT_DLP_PROXY_BLOCKED_PORTS', '3128,3129,8080,8888'),
            enable_https_fallback=os.getenv('YT_DLP_PROXY_ENABLE_HTTPS_FALLBACK', 'true').lower() == 'true'
        )


class ProxyManager:
    """
    Manages proxy pool and rotation for YouTube transcript requests.

    Supports two proxy sources:
    1. Free: ProxyScrape API (default, no signup required)
    2. Paid: Custom endpoint with API key (Webshare, Bright Data, etc.)
    """

    # ProxyScrape API endpoint for free proxies
    PROXYSCRAPE_URL = "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all"

    def __init__(self, config: ProxyConfig):
        """
        Initialize proxy manager with configuration.

        Args:
            config: ProxyConfig instance with settings
        """
        self.config = config
        self.proxy_pool: List[str] = []
        self.dead_proxies: List[str] = []
        self.last_refresh = 0
        self.refresh_interval = 3600  # Refresh pool every hour

    def get_fresh_proxies(self, count: int = 200) -> List[str]:
        """
        Fetch fresh proxies from configured source.

        Args:
            count: Maximum number of proxies to fetch

        Returns:
            List of proxy addresses in format "ip:port"
        """
        debug_log("PROXY_MANAGER", f"Fetching fresh proxies, type: {self.config.proxy_type}")

        if self.config.proxy_type == "paid" and self.config.paid_endpoint:
            return self._fetch_paid_proxies(count)
        else:
            return self._fetch_free_proxies(count)

    def _fetch_free_proxies(self, count: int) -> List[str]:
        """Fetch free proxies from ProxyScrape API."""
        try:
            response = requests.get(self.PROXYSCRAPE_URL, timeout=30)
            if response.status_code == 200:
                raw_proxies = response.text.strip().split('\n')

                # Filter valid proxies
                valid_proxies = []
                skipped_count = 0

                for proxy in raw_proxies:
                    proxy = proxy.strip()
                    if proxy and _is_valid_proxy_format(proxy):
                        valid_proxies.append(proxy)
                    else:
                        skipped_count += 1
                        debug_log("PROXY_MANAGER", f"Skipping invalid proxy format: {proxy[:50]}")

                debug_log("PROXY_MANAGER", f"Fetched {len(valid_proxies)} valid proxies from ProxyScrape (skipped {skipped_count} invalid)")
                return valid_proxies[:count]
            else:
                debug_log("PROXY_MANAGER", f"ProxyScrape returned status {response.status_code}: {response.text[:200]}")
                return []
        except Exception as e:
            debug_log("PROXY_MANAGER", f"Error fetching free proxies: {str(e)}")
            return []

    def _fetch_paid_proxies(self, count: int) -> List[str]:
        """
        Fetch proxies from paid service endpoint.

        Expected response format: JSON array of strings or newline-delimited list
        [{"ip": "1.2.3.4", "port": "8080"}, ...] or "1.2.3.4:8080\\n2.3.4.5:8080"
        """
        try:
            headers = {}
            if self.config.paid_api_key:
                headers['Authorization'] = f"Bearer {self.config.paid_api_key}"

            response = requests.get(self.config.paid_endpoint, headers=headers, timeout=30)

            if response.status_code == 200:
                # Try parsing as JSON first
                try:
                    data = response.json()
                    if isinstance(data, list):
                        # Handle list of objects {"ip": "x", "port": "y"} or list of strings
                        proxies = []
                        for item in data[:count]:
                            if isinstance(item, str):
                                proxies.append(item)
                            elif isinstance(item, dict):
                                ip = item.get('ip') or item.get('host') or item.get('address')
                                port = item.get('port')
                                if ip and port:
                                    proxies.append(f"{ip}:{port}")
                        debug_log("PROXY_MANAGER", f"Fetched {len(proxies)} proxies from paid service")
                        return proxies
                except json.JSONDecodeError:
                    # Treat as newline-delimited text
                    proxies = response.text.strip().split('\n')
                    debug_log("PROXY_MANAGER", f"Fetched {len(proxies)} proxies from paid service (text)")
                    return proxies[:count]
            else:
                debug_log("PROXY_MANAGER", f"Paid proxy service returned status {response.status_code}")
                return []

        except Exception as e:
            debug_log("PROXY_MANAGER", f"Error fetching paid proxies: {str(e)}")
            return []

    def test_proxy(self, proxy: str) -> bool:
        """
        Test if a proxy is working by making a request to test URL.

        Args:
            proxy: Proxy address in format "ip:port"

        Returns:
            True if proxy is working, False otherwise
        """
        try:
            proxy_dict = {
                "http": f"http://{proxy}",
                "https": f"http://{proxy}"
            }
            start = time.time()
            response = requests.get(
                self.config.test_url,
                proxies=proxy_dict,
                timeout=self.config.test_timeout
            )
            elapsed = time.time() - start

            if response.status_code == 200:
                # Check response time filter
                if elapsed > self.config.max_response_time:
                    debug_log("PROXY_MANAGER", f"Proxy {proxy} too slow ({elapsed:.2f}s), discarding")
                    return False
                debug_log("PROXY_MANAGER", f"Proxy {proxy} working ({elapsed:.2f}s)")
                return True
            else:
                debug_log("PROXY_MANAGER", f"Proxy {proxy} returned status {response.status_code}")
                return False

        except requests.Timeout:
            debug_log("PROXY_MANAGER", f"Proxy {proxy} timed out")
            return False
        except Exception as e:
            debug_log("PROXY_MANAGER", f"Proxy {proxy} failed: {str(e)}")
            return False

    def test_proxy_youtube(self, proxy: str) -> bool:
        """
        Test if a proxy can access YouTube by requesting robots.txt.

        Args:
            proxy: Proxy address in format "ip:port"

        Returns:
            True if proxy can access YouTube, False otherwise
        """
        try:
            proxy_dict = {
                "http": f"http://{proxy}",
                "https": f"http://{proxy}"
            }
            start = time.time()
            response = requests.get(
                "https://www.youtube.com/robots.txt",
                proxies=proxy_dict,
                timeout=10  # Longer timeout for YouTube
            )
            elapsed = time.time() - start

            if response.status_code == 200:
                # Check response time filter
                if elapsed > self.config.max_response_time:
                    debug_log("PROXY_MANAGER", f"Proxy {proxy} YouTube access too slow ({elapsed:.2f}s), discarding")
                    return False
                debug_log("PROXY_MANAGER", f"Proxy {proxy} passed YouTube test ({elapsed:.2f}s)")
                return True
            else:
                debug_log("PROXY_MANAGER", f"Proxy {proxy} YouTube test returned status {response.status_code}")
                return False

        except requests.Timeout:
            debug_log("PROXY_MANAGER", f"Proxy {proxy} YouTube test timed out")
            return False
        except Exception as e:
            debug_log("PROXY_MANAGER", f"Proxy {proxy} YouTube test failed: {str(e)[:100]}")
            return False

    def test_proxy_https_fallback(self, proxy: str) -> bool:
        """
        Fallback test for proxies that fail robots.txt.
        Tests strict HTTPS tunneling to catch proxies that fail with 502/503.

        This uses a simpler HTTPS endpoint that returns 204, which helps identify
        proxies that can properly tunnel HTTPS connections even if they fail
        the robots.txt test.

        Args:
            proxy: Proxy address in format "ip:port"

        Returns:
            True if proxy can tunnel HTTPS, False otherwise
        """
        try:
            proxy_dict = {
                "http": f"http://{proxy}",
                "https": f"http://{proxy}"
            }
            start = time.time()
            # Use generate_204 endpoint - simple HTTPS test that returns 204
            response = requests.get(
                "https://www.youtube.com/generate_204",
                proxies=proxy_dict,
                timeout=5
            )
            elapsed = time.time() - start

            if response.status_code == 204:
                # Check response time filter
                if elapsed > self.config.max_response_time:
                    debug_log("PROXY_MANAGER", f"Proxy {proxy} HTTPS fallback too slow ({elapsed:.2f}s), discarding")
                    return False
                debug_log("PROXY_MANAGER", f"Proxy {proxy} passed HTTPS fallback test ({elapsed:.2f}s)")
                return True
            else:
                debug_log("PROXY_MANAGER", f"Proxy {proxy} HTTPS fallback returned status {response.status_code}")
                return False

        except requests.Timeout:
            debug_log("PROXY_MANAGER", f"Proxy {proxy} HTTPS fallback timed out")
            return False
        except Exception as e:
            debug_log("PROXY_MANAGER", f"HTTPS fallback failed for {proxy}: {str(e)[:50]}")
            return False

    def _should_test_proxy(self, proxy: str) -> bool:
        """
        Pre-filter proxy based on port and other criteria before testing.

        Args:
            proxy: Proxy address in format "ip:port"

        Returns:
            True if proxy should be tested, False if should be skipped
        """
        try:
            port = int(proxy.split(':')[1])

            # Parse blocked ports from config string
            blocked_ports = [int(p.strip()) for p in self.config.blocked_ports.split(',') if p.strip().isdigit()]

            # Skip blocked ports
            if port in blocked_ports:
                debug_log("PROXY_MANAGER", f"Proxy {proxy} on blocked port {port}, skipping")
                return False

            # Skip known dead proxies
            if proxy in self.dead_proxies:
                return False

            return True

        except (ValueError, IndexError):
            debug_log("PROXY_MANAGER", f"Proxy {proxy} has invalid format, skipping")
            return False

    def get_working_proxies(self) -> List[str]:
        """
        Build a pool of working proxies by fetching and testing.
        Returns immediately when min_pool_size is reached for fast start.

        Returns:
            List of validated proxy addresses
        """
        # Check if we need to refresh
        current_time = time.time()
        if self.proxy_pool and (current_time - self.last_refresh) < self.refresh_interval:
            debug_log("PROXY_MANAGER", f"Using cached proxy pool ({len(self.proxy_pool)} proxies)")
            return self.proxy_pool

        debug_log("PROXY_MANAGER", "Building new proxy pool...")

        # Fetch fresh proxies
        fresh_proxies = self.get_fresh_proxies(200)
        if not fresh_proxies:
            debug_log("PROXY_MANAGER", "No proxies fetched, using empty pool")
            return []

        # Test proxies with early return for fast start
        working = []
        tested = 0
        random.shuffle(fresh_proxies)

        for proxy in fresh_proxies:
            # Stop conditions (any of these)
            if len(working) >= self.config.min_pool_size:
                debug_log("PROXY_MANAGER", f"Minimum pool size reached ({len(working)} proxies)")
                break
            if tested >= self.config.max_test_attempts:
                debug_log("PROXY_MANAGER", f"Max test attempts reached ({tested} tested, {len(working)} working)")
                break

            # Pre-filter proxy before testing
            if not self._should_test_proxy(proxy):
                continue

            tested += 1

            # Choose test strategy based on config
            proxy_passed = False

            if self.config.test_youtube_directly:
                # Primary test: YouTube robots.txt
                if self.test_proxy_youtube(proxy):
                    working.append(proxy)
                    proxy_passed = True
                elif self.config.enable_https_fallback:
                    # Fallback to HTTPS tunnel test (still counts as 1 attempt)
                    if self.test_proxy_https_fallback(proxy):
                        working.append(proxy)
                        proxy_passed = True
                        debug_log("PROXY_MANAGER", f"Proxy {proxy} added via HTTPS fallback")
            else:
                # Two-stage test: generic then YouTube
                if self.test_proxy(proxy):
                    # Additional YouTube validation
                    if self.test_proxy_youtube(proxy):
                        working.append(proxy)
                        proxy_passed = True
                    else:
                        debug_log("PROXY_MANAGER", f"Proxy {proxy} passed generic test but failed YouTube test")
                        self.dead_proxies.append(proxy)

            if proxy_passed:
                debug_log("PROXY_MANAGER", f"Pool now has {len(working)}/{self.config.min_pool_size} working proxies")
                time.sleep(0.5)  # Polite testing delay
            else:
                # Only add to dead_proxies if not already there (from _should_test_proxy or test methods)
                if proxy not in self.dead_proxies:
                    self.dead_proxies.append(proxy)

        self.proxy_pool = working
        self.last_refresh = current_time

        debug_log("PROXY_MANAGER", f"Built proxy pool with {len(working)} working proxies ({tested} tested)")
        return working

    def get_next_proxy(self) -> Optional[str]:
        """
        Get next proxy from pool with rotation.

        Returns:
            Proxy address or None if pool is empty
        """
        if not self.proxy_pool:
            self.get_working_proxies()

        if not self.proxy_pool:
            debug_log("PROXY_MANAGER", "No working proxies available")
            return None

        # Rotate proxies randomly
        proxy = random.choice(self.proxy_pool)
        debug_log("PROXY_MANAGER", f"Selected proxy: {proxy}")
        return proxy

    def rotate_with_retry(
        self,
        video_id: str,
        fetch_func: Callable[[str, Optional[str]], Any],
        languages: List[str] = None
    ) -> Dict[str, Any]:
        """
        Fetch transcript with proxy rotation and retry logic.

        Args:
            video_id: YouTube video ID
            fetch_func: Function that takes (video_id, proxy_url) and returns transcript
            languages: List of language codes to try

        Returns:
            Dict with success status and transcript or error
        """
        if not self.config.enabled:
            # Proxy disabled, call fetch_func directly
            debug_log("PROXY_MANAGER", "Proxy disabled, using direct connection")
            return self._try_direct(video_id, fetch_func, languages)

        languages = languages or ['en', 'en-auto', None]

        # Ensure we have a proxy pool
        self.get_working_proxies()

        if not self.proxy_pool:
            debug_log("PROXY_MANAGER", "No proxies available, falling back to direct connection")
            return self._try_direct(video_id, fetch_func, languages)

        # Try with proxy rotation - sequential iteration through proxies
        # Create a working copy to avoid modifying during iteration
        available_proxies = self.proxy_pool.copy()
        total_attempts = 0  # Track total attempts across all proxies

        for proxy_idx, proxy in enumerate(available_proxies):
            # Try this proxy up to max_retries times before moving to next
            for retry in range(self.config.max_retries):
                total_attempts += 1

                for lang in languages:
                    try:
                        debug_log("PROXY_MANAGER", f"Attempt {total_attempts} (proxy {proxy_idx + 1}/{len(available_proxies)}, retry {retry + 1}/{self.config.max_retries}) with proxy {proxy}, lang: {lang}")

                        # Import here to avoid issues if module not available
                        from youtube_transcript_api.proxies import GenericProxyConfig

                        proxy_config = GenericProxyConfig(
                            http_url=f"http://{proxy}",
                            https_url=f"http://{proxy}"
                        )

                        # Create fetch function with proxy
                        def proxied_fetch(vid, proxy_url=None):
                            from youtube_transcript_api import YouTubeTranscriptApi
                            api = YouTubeTranscriptApi(proxy_config=proxy_config)
                            if proxy_url:
                                api = YouTubeTranscriptApi(proxy_config=GenericProxyConfig(
                                    http_url=f"http://{proxy_url}",
                                    https_url=f"http://{proxy_url}"
                                ))
                            if lang:
                                return api.fetch(vid, languages=[lang])
                            else:
                                return api.fetch(vid)

                        transcript = proxied_fetch(video_id, proxy)

                        debug_log("PROXY_MANAGER", f"Successfully fetched transcript with proxy {proxy}")

                        return {
                            "success": True,
                            "transcript": transcript,
                            "proxy_used": proxy,
                            "method": "proxy"
                        }

                    except Exception as e:
                        debug_log("PROXY_MANAGER", f"Proxy {proxy} failed for lang {lang}: {str(e)}")
                        # Don't mark as dead yet - wait until all retries exhausted
                        continue

                # Exponential backoff between retries on same proxy
                if retry < self.config.max_retries - 1:
                    backoff = min(
                        self.config.min_backoff * (2 ** retry),
                        self.config.max_backoff
                    )
                    jitter = random.uniform(0, 5)
                    total_backoff = backoff + jitter
                    debug_log("PROXY_MANAGER", f"Backing off for {total_backoff:.1f} seconds before retrying proxy {proxy}")
                    time.sleep(total_backoff)

            # All retries exhausted for this proxy, mark as permanently dead
            if proxy not in self.dead_proxies:
                self.dead_proxies.append(proxy)
            if proxy in self.proxy_pool:
                self.proxy_pool.remove(proxy)
            debug_log("PROXY_MANAGER", f"Proxy {proxy} marked as dead after {self.config.max_retries} failures, moving to next proxy ({proxy_idx + 1}/{len(available_proxies)})")

        # All proxies exhausted, try direct connection
        debug_log("PROXY_MANAGER", f"All {len(available_proxies)} proxies exhausted after {total_attempts} attempts, trying direct connection")
        return self._try_direct(video_id, fetch_func, languages)

    def _try_direct(
        self,
        video_id: str,
        fetch_func: Callable[[str, Optional[str]], Any],
        languages: List[str]
    ) -> Dict[str, Any]:
        """
        Try fetching transcript without proxy.

        Args:
            video_id: YouTube video ID
            fetch_func: Function to call
            languages: List of language codes to try

        Returns:
            Dict with success status and transcript or error
        """
        for lang in languages:
            try:
                debug_log("PROXY_MANAGER", f"Trying direct connection, lang: {lang}")
                result = fetch_func(video_id, None)
                return {
                    "success": True,
                    "transcript": result,
                    "proxy_used": None,
                    "method": "direct"
                }
            except Exception as e:
                debug_log("PROXY_MANAGER", f"Direct connection failed for lang {lang}: {str(e)}")
                continue

        return {
            "success": False,
            "error": f"All methods failed for video {video_id}"
        }


# Convenience function for quick usage
def fetch_with_proxy_rotation(
    video_id: str,
    fetch_func: Callable[[str, Optional[str]], Any],
    languages: List[str] = None,
    config: ProxyConfig = None
) -> Dict[str, Any]:
    """
    Convenience function to fetch transcript with proxy rotation.

    Args:
        video_id: YouTube video ID
        fetch_func: Function that takes (video_id, proxy_url) and returns transcript
        languages: List of language codes to try
        config: ProxyConfig instance (uses env vars if not provided)

    Returns:
        Dict with success status and transcript or error
    """
    if config is None:
        config = ProxyConfig.from_env()

    if not config.enabled:
        # Proxy disabled, call directly
        for lang in (languages or ['en', 'en-auto', None]):
            try:
                result = fetch_func(video_id, None)
                return {
                    "success": True,
                    "transcript": result,
                    "proxy_used": None,
                    "method": "direct"
                }
            except Exception:
                continue
        return {"success": False, "error": "Direct connection failed"}

    manager = ProxyManager(config)
    return manager.rotate_with_retry(video_id, fetch_func, languages)

import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';

/**
 * Header component with mobile menu and filters
 * @param {boolean} isAuthenticated - User authentication status
 * @param {array} uniqueChannels - Array of unique channels
 * @param {array} uniquePlatforms - Array of unique platforms
 * @param {array} uniqueTags - Array of unique tags
 * @param {object} filters - Current filter selections
 * @param {function} onFilterChange - Callback when filters change
 */
function Header({ isAuthenticated, uniqueChannels = [], uniquePlatforms = [], uniqueTags = [], filters = {}, onFilterChange }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [displayedChannelsLimit, setDisplayedChannelsLimit] = useState(5);
  const [displayedPlatformsLimit, setDisplayedPlatformsLimit] = useState(5);
  const [displayedTagsLimit, setDisplayedTagsLimit] = useState(5);
  const location = useLocation();

  // Close menu on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Scroll to top when opening menu on mobile
  const toggleMenu = () => {
    setMenuOpen(!menuOpen);
    if (!menuOpen && window.innerWidth <= 768) {
      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    }
  };

  // Toggle channel filter
  const toggleChannel = (channel) => {
    const newChannels = new Set(filters.channels);
    if (newChannels.has(channel)) {
      newChannels.delete(channel);
    } else {
      newChannels.add(channel);
    }
    onFilterChange({ ...filters, channels: newChannels });
  };

  // Toggle platform filter
  const togglePlatform = (platform) => {
    const newPlatforms = new Set(filters.platforms);
    if (newPlatforms.has(platform)) {
      newPlatforms.delete(platform);
    } else {
      newPlatforms.add(platform);
    }
    onFilterChange({ ...filters, platforms: newPlatforms });
  };

  // Toggle tag filter
  const toggleTag = (tag) => {
    const newTags = new Set(filters.tags);
    if (newTags.has(tag)) {
      newTags.delete(tag);
    } else {
      newTags.add(tag);
    }
    onFilterChange({ ...filters, tags: newTags });
  };

  return (
    <header className="header bg-dark-card border-b border-gray-700">
      <div className="flex items-center justify-between px-1 py-4 sm:px-8">
        {/* Logo and Title */}
        <div className="flex items-center gap-3">
          <img
            src="/android-chrome-192x192.png"
            srcSet="/android-chrome-192x192.png 192w, /android-chrome-512x512.png 512w"
            sizes="(max-width: 768px) 50px, 80px"
            alt="AI Summaries Logo"
            className="w-12 h-12 md:w-20 md:h-20"
          />
          <h1 className="text-xl md:text-2xl font-bold text-text-primary tracking-wide">AI Summaries</h1>
        </div>

        {/* Mobile Menu Toggle */}
        <div className="mobile-menu-toggle">
          <button
            onClick={toggleMenu}
            className="p-2 text-text-primary hover:text-accent transition-colors"
            aria-label="Toggle menu"
          >
            <svg width="24" height="24" fill="currentColor" viewBox="0 0 24 24">
              <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Menu Container */}
      <div id="mainMenu" className={`menu-container ${menuOpen ? 'active' : ''}`}>
        {/* Admin Button */}
        <Link
          to="/admin"
          className="btn menu-btn bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded transition-colors"
          onClick={() => setMenuOpen(false)}
        >
          Admin
        </Link>

        <div className="menu-divider border-t border-gray-600 my-3"></div>

        {/* Channel Filters */}
        <div className="menu-filter-section mb-4">
          <h4 className="text-sm font-semibold text-text-primary mb-2">Channels</h4>
          <div className="flex flex-wrap gap-2">
            {uniqueChannels.slice(0, displayedChannelsLimit).map((channel, index) => (
              <button
                key={index}
                onClick={() => toggleChannel(channel)}
                className={`channel-option px-3 py-1 rounded cursor-pointer transition-colors ${
                  filters.channels?.has(channel) ? 'bg-accent text-white' : 'bg-gray-700 text-text-secondary hover:bg-gray-600'
                }`}
              >
                {channel}
              </button>
            ))}
          </div>
          {uniqueChannels.length > displayedChannelsLimit && (
            <div className="mt-2">
              <button
                onClick={() => setDisplayedChannelsLimit(uniqueChannels.length)}
                className="text-accent hover:text-accent-hover text-sm"
              >
                Show All Channels
              </button>
            </div>
          )}
        </div>

        {/* Platform Filters */}
        <div className="menu-filter-section mb-4">
          <h4 className="text-sm font-semibold text-text-primary mb-2">Platforms</h4>
          <div className="flex flex-wrap gap-2">
            {uniquePlatforms.slice(0, displayedPlatformsLimit).map((platform, index) => (
              <button
                key={index}
                onClick={() => togglePlatform(platform)}
                className={`platform-option px-3 py-1 rounded cursor-pointer transition-colors ${
                  filters.platforms?.has(platform) ? 'bg-accent text-white' : 'bg-gray-700 text-text-secondary hover:bg-gray-600'
                }`}
              >
                {platform.charAt(0).toUpperCase() + platform.slice(1)}
              </button>
            ))}
          </div>
          {uniquePlatforms.length > displayedPlatformsLimit && (
            <div className="mt-2">
              <button
                onClick={() => setDisplayedPlatformsLimit(uniquePlatforms.length)}
                className="text-accent hover:text-accent-hover text-sm"
              >
                Show All Platforms
              </button>
            </div>
          )}
        </div>

        {/* Tag Filters */}
        <div className="menu-filter-section mb-4">
          <h4 className="text-sm font-semibold text-text-primary mb-2">Tags</h4>
          <div className="flex flex-wrap gap-2">
            {uniqueTags.slice(0, displayedTagsLimit).map((tag, index) => (
              <button
                key={index}
                onClick={() => toggleTag(tag)}
                className={`tag-option px-3 py-1 rounded cursor-pointer transition-colors ${
                  filters.tags?.has(tag) ? 'bg-accent text-white' : 'bg-gray-700 text-text-secondary hover:bg-gray-600'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
          {uniqueTags.length > displayedTagsLimit && (
            <div className="mt-2">
              <button
                onClick={() => setDisplayedTagsLimit(uniqueTags.length)}
                className="text-accent hover:text-accent-hover text-sm"
              >
                Show All Tags
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

export default Header;
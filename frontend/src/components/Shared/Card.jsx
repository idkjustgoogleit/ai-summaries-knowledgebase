import React, { useState } from 'react';
import { getYouTubeId, getThumbnailUrl, getFaviconUrl, normalizeTags, formatDateTimeTZ } from '../../utils/helpers';

/**
 * Card component for displaying summaries
 * @param {object} summary - Summary object
 * @param {function} onFavoriteToggle - Function to handle favorite toggle
 * @param {function} onSelectToggle - Function to handle selection toggle
 * @param {boolean} isSelected - Whether the card is selected
 * @param {boolean} isFavorited - Whether the summary is favorited
 * @param {function} onClick - Function to handle card click
 */
function Card({ summary, onFavoriteToggle, onSelectToggle, isSelected, isFavorited, onClick }) {
  // State for handling image load errors (fixes XSS vulnerability)
  const [imageError, setImageError] = useState(false);

  // Determine source type and get visual elements
  const isWebsite = summary.source_type === 'website';
  const isCustom = summary.source_type === 'custom';

  let uniqueId = isWebsite || isCustom
    ? summary.id
    : (summary.videoid || summary.id);

  // Get thumbnail/favicon
  let thumbnailUrl = null;
  let sourceIcon = null;

  if (isWebsite) {
    thumbnailUrl = getFaviconUrl(summary.url);
    sourceIcon = <i className="fas fa-globe text-accent mr-1"></i>;
  } else if (isCustom) {
    thumbnailUrl = summary.other1 || '/public/android-chrome-512x512.png';
    sourceIcon = <i className="fas fa-file-alt mr-1"></i>;
  } else {
    const videoId = summary.url ? getYouTubeId(summary.url) : null;
    thumbnailUrl = videoId ? getThumbnailUrl(videoId) : (summary.cover || null);
    sourceIcon = <i className="fab fa-youtube text-red-500 mr-1"></i>;
  }

  // Get display content
  let displayContent = 'No description available';
  let isTldr = false;

  if (summary.tldr) {
    displayContent = summary.tldr;
    isTldr = true;
  } else if (summary.other2) {
    displayContent = summary.other2;
    isTldr = true;
  } else if (summary.description) {
    displayContent = summary.description;
  }

  // Get tags
  const tags = normalizeTags(summary.tags);
  const cacheKey = `${summary.source_type}_${uniqueId}`;

  // Handle favorite toggle
  const handleFavoriteClick = (e) => {
    e.stopPropagation();
    onFavoriteToggle(uniqueId, summary.source_type);
  };

  // Handle selection toggle
  const handleSelectClick = (e) => {
    e.stopPropagation();
    onSelectToggle(uniqueId, summary);
  };

  return (
    <div
      className="card bg-dark-card rounded-lg overflow-hidden transition-transform duration-200 hover:-translate-y-1 cursor-pointer"
      onClick={onClick}
    >
      {/* Thumbnail/Favicon */}
      {thumbnailUrl && !imageError ? (
        <div className="relative overflow-hidden aspect-video">
          <img
            src={thumbnailUrl}
            alt={summary.title || summary.name || 'Thumbnail'}
            className="absolute inset-0 w-full h-full object-cover"
            onError={() => setImageError(true)}
          />
        </div>
      ) : (
        <div className="relative overflow-hidden aspect-video bg-gray-700">
          <div className="absolute inset-0 flex items-center justify-center">
            <i className="fas fa-link text-2xl text-gray-400"></i>
            {isWebsite && <i className="fas fa-globe text-blue-500 ml-2"></i>}
          </div>
        </div>
      )}
      
      {/* Card Content */}
      <div className="p-2">
        <h3 className="summary-title-clamp font-semibold mb-2 line-clamp-2 text-text-primary tracking-wide">
          {summary.title || summary.name || 'Untitled'}
        </h3>
        
        <div className="flex justify-between items-center mb-2">
          <p className="text-text-secondary text-sm m-0">
            {sourceIcon}
            {summary.channel || summary.main_url || 'Unknown Source'}
          </p>
          
          <div className="flex gap-2">
            {/* Favorite Button */}
            <button
              onClick={handleFavoriteClick}
              className="bg-transparent border-none p-1 cursor-pointer hover:opacity-70"
              aria-label="Toggle favorite"
            >
              <i 
                className={`fas fa-heart ${isFavorited ? 'text-danger' : 'text-text-secondary'} text-base`}
              ></i>
            </button>
            
            {/* Chat Select Button */}
            <button
              onClick={handleSelectClick}
              className={`px-2 py-1 text-white text-sm rounded cursor-pointer transition-colors ${isSelected ? 'bg-emerald-500' : 'bg-gray-600'}`}
              aria-label={isSelected ? 'Deselect for chat' : 'Select for chat'}
            >
              <i className={`fas ${isSelected ? 'fa-check' : 'fa-plus'}`}></i> Chat
            </button>
          </div>
        </div>
        
        <p className="text-xs text-gray-600 my-2">
          Updated: {formatDateTimeTZ(summary.last_modified || summary.date_update)}
        </p>
        
        {/* TL;DR or Description */}
        {isTldr ? (
          <div className="tldr-section">
            <h4 className="text-xs uppercase text-text-secondary font-semibold my-2 mb-1">
              TL;DR
            </h4>
            <p className="tldr-content text-sm text-text-secondary m-0">
              {displayContent}
            </p>
          </div>
        ) : (
          <p className="text-sm text-text-secondary mb-4">
            {displayContent}
          </p>
        )}
        
        {/* Tags */}
        <div>
          {tags.slice(0, 3).map((tag, index) => (
            <span key={index} className="tag inline-block bg-gray-700 text-text-secondary text-xs px-2 py-1 rounded mr-1 mb-1">
              {tag}
            </span>
          ))}
          {tags.length > 3 && (
            <span className="tag inline-block bg-gray-700 text-text-secondary text-xs px-2 py-1 rounded">
              +{tags.length - 3}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default React.memo(Card);
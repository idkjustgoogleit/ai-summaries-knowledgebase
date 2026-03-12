// Extract YouTube video ID from URL
export function getYouTubeId(url) {
  if (!url) return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

// Get thumbnail URL from video ID
export function getThumbnailUrl(videoId) {
  return videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : null;
}

// Get favicon URL for websites
export function getFaviconUrl(url) {
  try {
    const domain = new URL(url).origin;
    return `https://www.google.com/s2/favicons?sz=64&domain=${domain}`;
  } catch (err) {
    console.warn(`Could not parse URL for favicon: ${url}`, err);
    return null;
  }
}

// Normalize tags from various formats
export function normalizeTags(tags) {
  if (!tags) return [];
  
  // Handle string that looks like JSON array
  if (typeof tags === 'string') {
    tags = tags.trim();
    if (tags.startsWith('[') && tags.endsWith(']')) {
      try {
        const parsed = JSON.parse(tags);
        if (Array.isArray(parsed)) {
          return parsed.map(tag => String(tag).trim()).filter(tag => tag);
        }
      } catch (e) {
        // If parsing fails, proceed with string processing
      }
    }
    
    // Handle comma-separated string with possible quotes
    return tags.split(',')
      .map(tag => {
        return tag.replace(/^["'\[\]{}]+|["'\[\]{}]+$/g, '').trim();
      })
      .filter(tag => tag && tag !== 'null' && tag !== 'undefined');
  }
  
  // Handle array
  if (Array.isArray(tags)) {
    return tags.map(tag => String(tag).trim()).filter(tag => tag);
  }
  
  return [];
}

// Format date with timezone
export function formatDateTimeTZ(dateString, timeZone = 'Europe/Amsterdam') {
  if (!dateString) return 'N/A';
  try {
    const date = new Date(dateString);
    return date.toLocaleString('nl-NL', {
      timeZone: timeZone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (e) {
    console.error('Error formatting date:', e);
    return 'Invalid date';
  }
}

// Debug logging functions
export function logDebug(message, data) {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[DEBUG] ${message}`, data);
  }
}

export function logError(message, error) {
  console.error(`[ERROR] ${message}`, error);
}
import React, { useState, useEffect } from 'react';
import { apiFetch } from '../../utils/api';
import LoadingSpinner from '../Shared/LoadingSpinner';

/**
 * FavoritesToggle - Favorite/unfavorite button component
 *
 * @param {string} summaryId - The ID of the summary
 * @param {string} summaryType - The type of summary ('custom' or default)
 * @param {boolean} isAuthenticated - Whether user is authenticated
 * @param {boolean} initialFavorited - Initial favorited state
 * @param {Function} onToggle - Callback when favorite status changes
 */
function FavoritesToggle({ summaryId, summaryType, isAuthenticated, initialFavorited, onToggle }) {
  const [isFavorited, setIsFavorited] = useState(initialFavorited || false);
  const [togglingFavorite, setTogglingFavorite] = useState(false);

  // Update local state when initialFavorited changes from parent
  useEffect(() => {
    setIsFavorited(initialFavorited || false);
  }, [initialFavorited]);

  const checkIfFavorited = async () => {
    if (!isAuthenticated) return;

    try {
      const endpoint = `/api/favorites/check?summaryId=${summaryId}&sourceType=${summaryType}`;

      const response = await apiFetch(endpoint);
      const data = await response.json();
      setIsFavorited(data.isFavorited || false);
    } catch (err) {
      console.error('Failed to check favorite status:', err);
      setIsFavorited(false);
    }
  };

  const handleToggleFavorite = async () => {
    if (!isAuthenticated || togglingFavorite) return;

    setTogglingFavorite(true);
    try {
      const method = isFavorited ? 'DELETE' : 'POST';

      const response = await apiFetch('/api/favorites', {
        method,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          summaryId,
          sourceType: summaryType
        })
      });

      const data = await response.json();
      const newFavoritedState = data.favorited ?? !isFavorited;
      setIsFavorited(newFavoritedState);

      // Notify parent of the change
      if (onToggle) {
        onToggle(newFavoritedState);
      }
    } catch (err) {
      console.error('Failed to toggle favorite:', err);
    } finally {
      setTogglingFavorite(false);
    }
  };

  // Check favorite status on mount
  useEffect(() => {
    checkIfFavorited();
  }, [summaryId, summaryType, isAuthenticated]);

  if (!isAuthenticated) return null;

  return (
    <button
      onClick={handleToggleFavorite}
      disabled={togglingFavorite}
      className="p-2 rounded-lg hover:bg-dark-card transition-colors disabled:opacity-50 border border-gray-700"
      title={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
    >
      {togglingFavorite ? (
        <LoadingSpinner size="sm" />
      ) : (
        <svg
          className={`w-5 h-5 ${isFavorited ? 'text-danger fill-current' : 'text-text-secondary'}`}
          fill={isFavorited ? 'currentColor' : 'none'}
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
          />
        </svg>
      )}
    </button>
  );
}

export default FavoritesToggle;

import { useState, useEffect, useCallback } from 'react';
import { fetchFavorites, toggleFavorite as apiToggleFavorite, removeFavorite as apiRemoveFavorite } from '../utils/api';

/**
 * Custom hook for managing favorites
 * @returns {object} - Favorites state and methods
 */
export function useFavorites(isAuthenticated = false) {
  const [favoritesCache, setFavoritesCache] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Load favorites on mount if authenticated
  useEffect(() => {
    if (isAuthenticated) {
      loadFavorites();
    } else {
      // Clear cache when not authenticated
      setFavoritesCache({});
    }
  }, [isAuthenticated]);

  /**
   * Load favorites from API
   */
  const loadFavorites = async () => {
    if (!isAuthenticated) return;
    
    try {
      setLoading(true);
      setError(null);
      
      const favorites = await fetchFavorites();
      
      // Build cache from favorites array
      const cache = {};
      favorites.forEach(fav => {
        cache[fav.cacheKey] = true;
      });
      
      setFavoritesCache(cache);
      console.log('Favorites loaded:', Object.keys(cache).length, 'items');
    } catch (error) {
      console.error('Error loading favorites:', error);
      setError(error.message || 'Failed to load favorites');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Check if a summary is favorited
   */
  const isFavorited = useCallback((summaryId, sourceType) => {
    const cacheKey = `${sourceType}_${summaryId}`;
    return !!favoritesCache[cacheKey];
  }, [favoritesCache]);

  /**
   * Toggle favorite status
   */
  const toggleFavorite = useCallback(async (summaryId, sourceType) => {
    if (!isAuthenticated) {
      alert('Please log in to add favorites');
      return;
    }
    
    const cacheKey = `${sourceType}_${summaryId}`;
    const isCurrentlyFavorited = !!favoritesCache[cacheKey];
    
    try {
      setError(null);
      
      let result;
      if (isCurrentlyFavorited) {
        // Remove favorite
        result = await apiRemoveFavorite(summaryId, sourceType);
      } else {
        // Add favorite
        result = await apiToggleFavorite(summaryId, sourceType);
      }
      
      // Update cache
      setFavoritesCache(prev => {
        const newCache = { ...prev };
        if (result.favorited) {
          newCache[cacheKey] = true;
          console.log('Added to favorites:', cacheKey);
        } else {
          delete newCache[cacheKey];
          console.log('Removed from favorites:', cacheKey);
        }
        return newCache;
      });
      
      return { success: true, favorited: result.favorited };
    } catch (error) {
      console.error('Error toggling favorite:', error);
      setError(error.message || 'Failed to update favorite');
      alert('Failed to update favorite. Please try again.');
      return { success: false, error: error.message };
    }
  }, [isAuthenticated, favoritesCache]);

  /**
   * Get all favorited cache keys
   */
  const getFavoritedIds = useCallback(() => {
    return Object.keys(favoritesCache);
  }, [favoritesCache]);

  /**
   * Get favorited count
   */
  const favoritedCount = Object.keys(favoritesCache).length;

  return {
    // Data
    favoritesCache,
    favoritedCount,
    
    // State
    loading,
    error,
    
    // Methods
    isFavorited,
    toggleFavorite,
    loadFavorites,
    getFavoritedIds
  };
}
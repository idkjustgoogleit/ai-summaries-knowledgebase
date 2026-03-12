import { useState, useEffect, useCallback, useMemo } from 'react';
import { fetchSummaries } from '../utils/api';
import { normalizeTags } from '../utils/helpers';

/**
 * Custom hook for managing summaries data
 * @param {string} userFilter - 'all', 'mine', or 'favorites'
 * @returns {object} - Summaries state and methods
 */
export function useSummaries(userFilter = 'all') {
  const [allSummaries, setAllSummaries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState('date_created');
  const [sortDirection, setSortDirection] = useState('desc');
  const [filters, setFilters] = useState({
    channels: new Set(),
    platforms: new Set(),
    tags: new Set()
  });
  const [columnCount, setColumnCount] = useState(3);
  const [appTimeZone, setAppTimeZone] = useState('Europe/Amsterdam');

  // Load summaries on mount and when user filter changes
  useEffect(() => {
    loadSummaries();
  }, [userFilter]);

  // Fetch timezone on mount
  useEffect(() => {
    fetchTimezone();
  }, []);

  /**
   * Fetch timezone from backend
   */
  const fetchTimezone = async () => {
    try {
      const response = await fetch('/api/config');
      if (response.ok) {
        const config = await response.json();
        setAppTimeZone(config.TZ || 'Europe/Amsterdam');
      }
    } catch (error) {
      console.error('Error fetching timezone:', error);
    }
  };

  /**
   * Load summaries from API
   */
  const loadSummaries = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const summaries = await fetchSummaries(userFilter);
      setAllSummaries(summaries);
    } catch (error) {
      console.error('Error loading summaries:', error);
      setError(error.message || 'Failed to load summaries');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Get unique values for filters
   */
  const uniqueValues = useMemo(() => {
    const channels = [...new Set(allSummaries.map(s => s.channel).filter(c => c))];
    
    const sourceTypesSet = new Set(allSummaries.map(s => s.source_type));
    const platforms = [...sourceTypesSet].map(type => {
      if (type === 'video') return 'Videos';
      if (type === 'website') return 'Websites';
      if (type === 'custom') return 'Custom Summaries';
      return type.charAt(0).toUpperCase() + type.slice(1) + 's';
    }).filter(p => p !== 'Unknowns');
    
    const allTags = [];
    allSummaries.forEach(summary => {
      const tags = normalizeTags(summary.tags);
      allTags.push(...tags);
    });
    const tags = [...new Set(allTags.filter(tag => tag))];
    
    return { channels, platforms, tags };
  }, [allSummaries]);

  /**
   * Filter and sort summaries
   */
  const filteredSummaries = useMemo(() => {
    let filtered = [...allSummaries];

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(summary => {
        const name = (summary.name || summary.title || '').toLowerCase();
        const channel = (summary.channel || '').toLowerCase();
        const description = (summary.description || '').toLowerCase();
        const tldr = (summary.tldr || summary.other2 || '').toLowerCase();
        const tags = normalizeTags(summary.tags).join(' ').toLowerCase();

        return name.includes(query) ||
          channel.includes(query) ||
          description.includes(query) ||
          tldr.includes(query) ||
          tags.includes(query);
      });
    }

    // Filter by selected channels
    if (filters.channels.size > 0) {
      filtered = filtered.filter(summary =>
        summary.channel && filters.channels.has(summary.channel)
      );
    }

    // Filter by selected platforms
    if (filters.platforms.size > 0) {
      filtered = filtered.filter(summary => {
        let sourceTypeLabel = '';
        if (summary.source_type === 'video') {
          sourceTypeLabel = 'Videos';
        } else if (summary.source_type === 'website') {
          sourceTypeLabel = 'Websites';
        } else if (summary.source_type === 'custom') {
          sourceTypeLabel = 'Custom Summaries';
        }
        return sourceTypeLabel && filters.platforms.has(sourceTypeLabel);
      });
    }

    // Filter by selected tags
    if (filters.tags.size > 0) {
      filtered = filtered.filter(summary => {
        const summaryTags = normalizeTags(summary.tags);
        return [...filters.tags].every(selectedTag =>
          summaryTags.some(tag => tag === selectedTag)
        );
      });
    }

    // Sort
    filtered.sort((a, b) => {
      let dateA, dateB;
      
      if (sortField === 'date_update') {
        dateA = a.last_modified ? new Date(a.last_modified) : new Date(0);
        dateB = b.last_modified ? new Date(b.last_modified) : new Date(0);
      } else if (sortField === 'date_created') {
        dateA = a.date_created ? new Date(a.date_created) : new Date(0);
        dateB = b.date_created ? new Date(b.date_created) : new Date(0);
      } else {
        dateA = a.last_modified ? new Date(a.last_modified) : new Date(0);
        dateB = b.last_modified ? new Date(b.last_modified) : new Date(0);
      }
      
      return sortDirection === 'asc' ? dateA - dateB : dateB - dateA;
    });

    return filtered;
  }, [allSummaries, searchQuery, sortField, sortDirection, filters]);

  /**
   * Generic filter toggle - handles channels, platforms, and tags
   * Reduces code duplication from 40+ lines to ~15 lines
   */
  const toggleFilter = useCallback((filterType, value) => {
    setFilters(prev => {
      const newSet = new Set(prev[filterType]);
      newSet.has(value) ? newSet.delete(value) : newSet.add(value);
      return { ...prev, [filterType]: newSet };
    });
  }, []);

  /**
   * Toggle channel filter
   */
  const toggleChannel = (channel) => toggleFilter('channels', channel);

  /**
   * Toggle platform filter
   */
  const togglePlatform = (platform) => toggleFilter('platforms', platform);

  /**
   * Toggle tag filter
   */
  const toggleTag = (tag) => toggleFilter('tags', tag);

  /**
   * Clear all filters
   */
  const clearFilters = useCallback(() => {
    setFilters({
      channels: new Set(),
      platforms: new Set(),
      tags: new Set()
    });
    setSearchQuery('');
  }, []);

  return {
    // Data
    allSummaries,
    filteredSummaries,
    uniqueValues,
    
    // Loading state
    loading,
    error,
    
    // Search and filters
    searchQuery,
    setSearchQuery,
    sortField,
    setSortField,
    sortDirection,
    setSortDirection,
    filters,
    setFilters,
    toggleChannel,
    togglePlatform,
    toggleTag,
    clearFilters,
    
    // Display options
    columnCount,
    setColumnCount,
    
    // App config
    appTimeZone,
    
    // Actions
    refresh: loadSummaries
  };
}
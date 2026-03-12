import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSummaries } from '../hooks/useSummaries';
import { useFavorites } from '../hooks/useFavorites';
import Header from './Shared/Header';
import Card from './Shared/Card';
import LoadingSpinner from './Shared/LoadingSpinner';

const CHAT_SELECTION_STORAGE_KEY = 'chatArenaInitialSummaries';

  function MainPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [userFilter, setUserFilter] = useState('all');
  const [showControls, setShowControls] = useState(false);

  // Set default controls visibility based on screen size
  useEffect(() => {
    const checkScreenSize = () => {
      const isMobile = window.innerWidth < 640; // sm breakpoint
      setShowControls(!isMobile); // Show by default on desktop, hide on mobile
    };

    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);
  
  const {
    filteredSummaries,
    uniqueValues,
    loading,
    error,
    searchQuery,
    setSearchQuery,
    sortField,
    setSortField,
    sortDirection,
    setSortDirection,
    filters,
    setFilters,
    columnCount,
    setColumnCount,
    refresh
  } = useSummaries(userFilter);
  
  const { isFavorited, toggleFavorite: toggleFav } = useFavorites(isAuthenticated);
  
  const [selectedSummaries, setSelectedSummaries] = useState({});

  useEffect(() => {
    const savedIds = JSON.parse(localStorage.getItem(CHAT_SELECTION_STORAGE_KEY) || '[]');
    const initialSelections = {};
    savedIds.forEach(id => {
      initialSelections[id] = true;
    });
    setSelectedSummaries(initialSelections);
  }, []);

  const handleCardClick = (summary) => {
    const isWebsite = summary.source_type === 'website';
    const isCustom = summary.source_type === 'custom';
    let uniqueId = isWebsite || isCustom 
      ? summary.id 
      : (summary.videoid || summary.id);
    
    navigate(`/summary/${summary.source_type}/${uniqueId}`);
  };

  const handleFavoriteToggle = async (summaryId, sourceType) => {
    await toggleFav(summaryId, sourceType);
    if (userFilter === 'favorites') {
      refresh();
    }
  };

  const handleSelectToggle = (id, summary) => {
    setSelectedSummaries(prev => {
      const newSelections = { ...prev };
      if (newSelections[id]) {
        delete newSelections[id];
      } else {
        newSelections[id] = summary;
      }
      localStorage.setItem(CHAT_SELECTION_STORAGE_KEY, JSON.stringify(Object.keys(newSelections)));
      return newSelections;
    });
  };

  const handleClearSelections = () => {
    if (Object.keys(selectedSummaries).length === 0) return;
    if (confirm('Clear all selected summaries for chat?')) {
      setSelectedSummaries({});
      localStorage.removeItem(CHAT_SELECTION_STORAGE_KEY);
    }
  };

  const handleChatSelected = () => {
    const selectedIds = Object.keys(selectedSummaries);
    if (selectedIds.length === 0) {
      alert('Please select at least one summary first.');
      return;
    }
    navigate('/arena');
  };

  const getGridClasses = () => {
    const classes = {
      1: 'grid grid-cols-1 gap-4',
      2: 'grid grid-cols-1 md:grid-cols-2 gap-4',
      3: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4',
      4: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'
    };
    return classes[columnCount] || classes[3];
  };

  const showUserFilter = isAuthenticated;

  return (
    <div className="min-h-screen bg-dark-bg">
      <Header
        isAuthenticated={isAuthenticated}
        uniqueChannels={uniqueValues.channels}
        uniquePlatforms={uniqueValues.platforms}
        uniqueTags={uniqueValues.tags}
        filters={filters}
        onFilterChange={setFilters}
      />

      <div className="container mx-auto p-1 max-w-7xl sm:p-8">
        {/* Action buttons - spread evenly, icon-only on mobile */}
        <div className="flex flex-1 gap-2 sm:gap-3 mb-6">
          <button
            onClick={() => navigate('/request')}
            className="action-btn bg-accent hover:bg-accent-hover text-white h-10 sm:h-12 px-3 sm:px-4 rounded-lg flex items-center justify-center gap-2 shadow-md hover:shadow-lg transform hover:scale-105 active:scale-95 transition-all duration-200 flex-1"
          >
            <i className="fas fa-plus-circle text-lg sm:text-sm"></i>
            <span className="text-sm">Request Content</span>
          </button>
          
          <button
            onClick={handleClearSelections}
            disabled={Object.keys(selectedSummaries).length === 0}
            className="action-btn bg-warning hover:bg-yellow-600 disabled:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none disabled:transform-none text-white h-10 sm:h-12 px-3 sm:px-4 rounded-lg flex items-center justify-center gap-2 shadow-md hover:shadow-lg transform hover:scale-105 active:scale-95 transition-all duration-200 flex-1"
          >
            <i className="fas fa-times text-lg sm:text-sm"></i>
            <span className="text-sm">Clear Selections</span>
          </button>
          
          <button
            onClick={() => navigate('/arena')}
            className="action-btn bg-success hover:bg-green-600 text-white h-10 sm:h-12 px-3 sm:px-4 rounded-lg flex items-center justify-center gap-2 shadow-md hover:shadow-lg transform hover:scale-105 active:scale-95 transition-all duration-200 flex-1"
          >
            <i className="fas fa-comments text-lg sm:text-sm"></i>
            <span className="text-sm">Chat</span>
            {Object.keys(selectedSummaries).length > 0 && (
              <span className="ml-1 text-sm">({Object.keys(selectedSummaries).length})</span>
            )}
          </button>
        </div>

        <div className="search-bar mb-6">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search summaries..."
            className="w-full px-4 py-3 bg-dark-card border border-gray-600 rounded-lg text-text-primary placeholder-text-secondary focus:outline-none focus:border-accent transition-colors"
          />
        </div>

        {/* Controls toggle button - mobile only */}
        <button
          onClick={() => setShowControls(!showControls)}
          className="sm:hidden w-full mb-3 bg-dark-card border border-gray-700 text-text-secondary p-3 rounded-lg flex items-center justify-center gap-2 hover:bg-dark-border transition-colors"
        >
          <i className={`fas fa-chevron-${showControls ? 'up' : 'down'}`}></i>
          <span>{showControls ? 'Hide Controls' : 'Show Controls'}</span>
        </button>

        {/* Controls section - collapsible on mobile, compact layout */}
        <div className={`controls ${!showControls && 'hidden sm:flex'} flex flex-col sm:flex-row gap-4 mb-6 p-2 sm:p-4 bg-dark-card rounded-lg border border-gray-700`}>
          {/* Sort controls - inline on all screens */}
          <div className="control-group flex items-center gap-2 flex-wrap">
            <label className="text-text-secondary whitespace-nowrap text-xs sm:text-sm">Sort by:</label>
            <select
              value={sortField}
              onChange={(e) => setSortField(e.target.value)}
              className="px-2 sm:px-3 py-1 sm:py-2 bg-dark-bg border border-gray-600 rounded text-text-primary focus:outline-none focus:border-accent min-w-[120px] sm:min-w-[140px] text-xs sm:text-sm"
            >
              <option value="date_created">Date Created</option>
              <option value="date_update">Date Updated</option>
            </select>
            <select
              value={sortDirection}
              onChange={(e) => setSortDirection(e.target.value)}
              className="px-2 sm:px-3 py-1 sm:py-2 bg-dark-bg border border-gray-600 rounded text-text-primary focus:outline-none focus:border-accent min-w-[100px] sm:min-w-[120px] text-xs sm:text-sm"
            >
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </div>
          
          {/* User filter and column controls */}
          <div className="control-group flex items-center gap-2 sm:gap-4 flex-wrap">
            {showUserFilter && (
              <select
                value={userFilter}
                onChange={(e) => setUserFilter(e.target.value)}
                className="px-2 sm:px-3 py-1 sm:py-2 bg-dark-bg border border-gray-600 rounded text-text-primary focus:outline-none focus:border-accent text-xs sm:text-sm"
              >
                <option value="all">Show All</option>
                <option value="mine">Show Mine</option>
                <option value="favorites">Favorites</option>
              </select>
            )}
            
            {/* Column selection - hidden on mobile */}
            <div className="hidden sm:flex items-center gap-2">
              <label className="text-text-secondary whitespace-nowrap text-sm">Columns:</label>
              <select
                value={columnCount}
                onChange={(e) => setColumnCount(parseInt(e.target.value))}
                className="px-3 py-2 bg-dark-bg border border-gray-600 rounded text-text-primary focus:outline-none focus:border-accent text-sm"
              >
                <option value={1}>1 Column</option>
                <option value={2}>2 Columns</option>
                <option value={3}>3 Columns</option>
                <option value={4}>4 Columns</option>
              </select>
            </div>
          </div>
        </div>

        {loading && (
          <div className="flex justify-center py-12">
            <LoadingSpinner size="lg" text="Loading summaries..." />
          </div>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-600 rounded-lg p-4 mb-6">
            <p className="text-red-400">Error: {error}</p>
            <button
              onClick={refresh}
              className="mt-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && (
          <div className={getGridClasses()}>
            {filteredSummaries.length === 0 ? (
              <div className="col-span-full text-center py-12 text-text-secondary">
                <p>No summaries found.</p>
                {(searchQuery || filters.channels.size > 0 || filters.platforms.size > 0 || filters.tags.size > 0) && (
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      setFilters({ channels: new Set(), platforms: new Set(), tags: new Set() });
                    }}
                    className="mt-4 px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded transition-colors"
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            ) : (
              filteredSummaries.map(summary => (
                <Card
                  key={`${summary.source_type}_${summary.id || summary.videoid}`}
                  summary={summary}
                  onFavoriteToggle={handleFavoriteToggle}
                  onSelectToggle={handleSelectToggle}
                  isSelected={!!selectedSummaries[summary.id || summary.videoid]}
                  isFavorited={isFavorited(summary.id || summary.videoid, summary.source_type)}
                  onClick={() => handleCardClick(summary)}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default MainPage;
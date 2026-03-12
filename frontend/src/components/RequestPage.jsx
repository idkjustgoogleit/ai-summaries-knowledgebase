import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';
import LoadingSpinner from './Shared/LoadingSpinner';

function RequestPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  
  const [activeTab, setActiveTab] = useState('video');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  
  // Form states
  const [videoUrl, setVideoUrl] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  const [customContent, setCustomContent] = useState('');
  
  // File upload states
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileInfo, setFileInfo] = useState(null);
  
  // Progress states
  const [progressItems, setProgressItems] = useState([]);
  const [isLoadingProgress, setIsLoadingProgress] = useState(false);
  const [progressRefreshInterval, setProgressRefreshInterval] = useState(null);
  
  // Playlist states
  const [playlist, setPlaylist] = useState(null);
  const [playlistVideos, setPlaylistVideos] = useState([]);
  const [isLoadingPlaylist, setIsLoadingPlaylist] = useState(false);
  const [playlistUrl, setPlaylistUrl] = useState('');

  // Redirect if not authenticated
  if (!isAuthenticated) {
    navigate('/');
    return null;
  }

  // Load progress when switching to progress tab
  useEffect(() => {
    if (activeTab === 'progress') {
      loadProgress();
      startAutoRefresh();
    } else {
      stopAutoRefresh();
    }
    
    // Load playlist when switching to playlist tab
    if (activeTab === 'playlist') {
      loadPlaylist();
    }
  }, [activeTab]);

  // Cleanup interval on unmount
  useEffect(() => {
    return () => stopAutoRefresh();
  }, []);

  // Load progress data
  const loadProgress = async () => {
    if (isLoadingProgress) return;
    
    setIsLoadingProgress(true);
    try {
      const response = await apiFetch('/api/import/progress');
      if (response.ok) {
        const data = await response.json();
        setProgressItems(data);
      }
    } catch (err) {
      console.error('Error loading progress:', err);
    } finally {
      setIsLoadingProgress(false);
    }
  };

  // Start auto-refresh (every 10 seconds)
  const startAutoRefresh = () => {
    stopAutoRefresh();
    const interval = setInterval(() => {
      if (activeTab === 'progress') {
        loadProgress();
      }
    }, 10000);
    setProgressRefreshInterval(interval);
  };

  // Stop auto-refresh
  const stopAutoRefresh = () => {
    if (progressRefreshInterval) {
      clearInterval(progressRefreshInterval);
      setProgressRefreshInterval(null);
    }
  };

  // Extract YouTube video ID from URL
  const extractYouTubeId = (url) => {
    if (!url) return null;
    
    // Handle full URLs
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    if (match && match[2].length === 11) {
      return match[2];
    }
    
    // Handle video ID directly
    if (url.length === 11 && /^[a-zA-Z0-9_-]+$/.test(url)) {
      return url;
    }
    
    return null;
  };

  // Format file size
  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Format date for display
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) {
      return 'Just now';
    } else if (diffMins < 60) {
      return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    } else if (diffDays < 7) {
      return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    } else {
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  };

  // Get progress percentage based on status and source type
  const getProgressPercentage = (status, sourceType) => {
    if (sourceType === 'video') {
      // Video has 5 stages (after parser worker removal)
      const statusProgress = {
        'NEW_YTDLP': 20,
        'PENDING_YTDLP': 40,
        'NEW': 60,
        'PENDING': 80,
        'DONE': 100,
        'FAILED': 0
      };
      return statusProgress[status] || 0;
    } else {
      // Website and custom have 3 stages
      const statusProgress = {
        'NEW': 33,
        'PENDING': 67,
        'DONE': 100,
        'FAILED': 0
      };
      return statusProgress[status] || 0;
    }
  };

  // Get progress color class
  const getProgressColorClass = (percentage) => {
    if (percentage <= 43) return 'bg-yellow-500';
    if (percentage <= 71) return 'bg-blue-500';
    return 'bg-green-500';
  };

  // Handle video submission
  const handleSubmitVideo = async (e) => {
    e.preventDefault();
    if (!videoUrl.trim()) {
      setError('Please enter a video URL');
      return;
    }

    const videoId = extractYouTubeId(videoUrl.trim());
    if (!videoId) {
      setError('Please enter a valid YouTube URL or Video ID');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await apiFetch('/api/import/grab', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          videoId: videoId,
          url: videoUrl.trim(),
        }),
      });

      const result = await response.json();

      if (response.ok) {
        setSuccess('Video imported successfully! It will be processed soon.');
        setVideoUrl('');
      } else {
        setError(result.error || 'Failed to submit video request');
      }
    } catch (err) {
      setError(err.message || 'An error occurred while submitting the request');
    } finally {
      setLoading(false);
    }
  };

  // Handle website submission
  const handleSubmitWebsite = async (e) => {
    e.preventDefault();
    if (!websiteUrl.trim()) {
      setError('Please enter a website URL');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await apiFetch('/api/grab-website', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: websiteUrl.trim(),
        }),
      });

      const result = await response.json();

      if (response.ok) {
        setSuccess('Website request submitted successfully! It will be processed soon.');
        setWebsiteUrl('');
      } else {
        setError(result.error || 'Failed to submit website request');
      }
    } catch (err) {
      setError(err.message || 'An error occurred while submitting the request');
    } finally {
      setLoading(false);
    }
  };

  // Handle custom content submission
  const handleSubmitCustom = async (e) => {
    e.preventDefault();
    if (!customTitle.trim() || !customContent.trim()) {
      setError('Please enter both title and content');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await apiFetch('/api/grabCustom', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: customTitle.trim(),
          type: 'custom',
          source: null,
          content: customContent.trim(),
        }),
      });

      const result = await response.json();

      if (response.ok) {
        setSuccess('Custom content submitted successfully!');
        setCustomTitle('');
        setCustomContent('');
      } else {
        setError(result.error || 'Failed to submit custom content');
      }
    } catch (err) {
      setError(err.message || 'An error occurred while submitting the request');
    } finally {
      setLoading(false);
    }
  };

  // Handle file selection
  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    
    if (!file) {
      setSelectedFile(null);
      setFileInfo(null);
      return;
    }

    // Validate file type
    if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
      setError('Please select a JSON file');
      e.target.value = '';
      setSelectedFile(null);
      setFileInfo(null);
      return;
    }

    // Validate file size (5MB limit)
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      setError('File size exceeds 5MB limit');
      e.target.value = '';
      setSelectedFile(null);
      setFileInfo(null);
      return;
    }

    setSelectedFile(file);
    setError(null);

    // Read and parse JSON to get record count
    const reader = new FileReader();
    reader.onload = function(event) {
      try {
        const data = JSON.parse(event.target.result);
        const records = Array.isArray(data) ? data : [data];
        setFileInfo({
          name: file.name,
          size: file.size,
          recordCount: records.length
        });
      } catch (error) {
        setError('Invalid JSON file format');
        setSelectedFile(null);
        setFileInfo(null);
      }
    };
    reader.readAsText(file);
  };

  // Handle file upload
  const handleFileUpload = async () => {
    if (!selectedFile) {
      setError('Please select a file first');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      // Read file content
      const fileContent = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(new Error('Failed to read file'));
        reader.readAsText(selectedFile);
      });

      // Parse JSON
      const jsonData = JSON.parse(fileContent);
      
      const response = await apiFetch('/api/import/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(jsonData),
      });

      const result = await response.json();

      if (response.ok) {
        setSuccess(result.message || 'File uploaded successfully!');
        setSelectedFile(null);
        setFileInfo(null);
        // Clear file input
        document.getElementById('file-input').value = '';
      } else {
        setError(result.error || 'Failed to upload file');
      }
    } catch (err) {
      setError(err.message || 'An error occurred while uploading file');
    } finally {
      setLoading(false);
    }
  };

  // Load playlist data
  const loadPlaylist = async () => {
    if (isLoadingPlaylist) return;
    
    setIsLoadingPlaylist(true);
    try {
      const response = await apiFetch('/api/playlist');
      if (response.ok) {
        const data = await response.json();
        setPlaylist(data);
      }
    } catch (err) {
      console.error('Error loading playlist:', err);
    } finally {
      setIsLoadingPlaylist(false);
    }
  };

  // Load playlist videos preview
  const loadPlaylistVideos = async () => {
    setIsLoadingPlaylist(true);
    try {
      const response = await apiFetch('/api/playlist/videos');
      if (response.ok) {
        const data = await response.json();
        setPlaylistVideos(data.videos || []);
      }
    } catch (err) {
      console.error('Error loading playlist videos:', err);
    } finally {
      setIsLoadingPlaylist(false);
    }
  };

  // Handle add playlist
  const handleAddPlaylist = async (e) => {
    e.preventDefault();
    if (!playlistUrl.trim()) {
      setError('Please enter a playlist URL');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await apiFetch('/api/playlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          playlist_url: playlistUrl.trim(),
        }),
      });

      const result = await response.json();

      if (response.ok) {
        setSuccess('Playlist added successfully! New videos will be imported automatically.');
        setPlaylistUrl('');
        setPlaylist(result.playlist);
      } else {
        setError(result.error || 'Failed to add playlist');
      }
    } catch (err) {
      setError(err.message || 'An error occurred while adding playlist');
    } finally {
      setLoading(false);
    }
  };

  // Handle delete playlist
  const handleDeletePlaylist = async () => {
    if (!window.confirm('Are you sure you want to remove this playlist subscription?')) {
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await apiFetch('/api/playlist', {
        method: 'DELETE',
      });

      const result = await response.json();

      if (response.ok) {
        setSuccess('Playlist subscription removed successfully.');
        setPlaylist(null);
        setPlaylistVideos([]);
      } else {
        setError(result.error || 'Failed to delete playlist');
      }
    } catch (err) {
      setError(err.message || 'An error occurred while deleting playlist');
    } finally {
      setLoading(false);
    }
  };

  // Handle playlist status change (pause/resume)
  const handlePlaylistStatusChange = async (newStatus) => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await apiFetch('/api/playlist/status', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: newStatus,
        }),
      });

      const result = await response.json();

      if (response.ok) {
        setSuccess(`Playlist ${newStatus === 'active' ? 'resumed' : 'paused'} successfully.`);
        setPlaylist(result.playlist);
      } else {
        setError(result.error || 'Failed to update playlist status');
      }
    } catch (err) {
      setError(err.message || 'An error occurred while updating playlist status');
    } finally {
      setLoading(false);
    }
  };

  // Handle job restart
  const handleRestartJob = async (id, sourceType) => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      let endpoint;
      switch (sourceType) {
        case 'video':
          endpoint = `/api/import/${id}/restart`;
          break;
        case 'website':
          endpoint = `/api/summaries/websites/${id}/restart`;
          break;
        case 'custom':
          endpoint = `/api/summaries-custom/${id}/restart`;
          break;
        default:
          throw new Error('Unknown source type');
      }

      const response = await apiFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json();

      if (response.ok) {
        setSuccess('Job restarted successfully!');
        // Refresh progress to show updated status
        await loadProgress();
      } else {
        setError(result.error || 'Failed to restart job');
      }
    } catch (err) {
      setError(err.message || 'An error occurred while restarting the job');
    } finally {
      setLoading(false);
    }
  };

  const tabs = [
    { id: 'video', label: 'Video URL', icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    )},
    { id: 'website', label: 'Website URL', icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
      </svg>
    )},
    { id: 'custom', label: 'Custom Content', icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    )},
    { id: 'file', label: 'File Import', icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
      </svg>
    )},
    { id: 'progress', label: 'Progress', count: progressItems.length, icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    )},
    { id: 'playlist', label: 'Playlist', icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
      </svg>
    )},
  ];

  return (
    <div className="min-h-screen bg-dark-bg">
      {/* Header */}
      <div className="border-b border-dark-card bg-dark-bg">
        <div className="container mx-auto px-1 py-6">
          <h1 className="text-3xl font-bold text-white mb-2">Request Content</h1>
          <p className="text-text-secondary">
            Submit videos, websites, or custom content for AI summarization
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-1 py-8 max-w-3xl">
        {/* Tabs */}
        <div className="flex gap-2 mb-6 bg-dark-card p-1 rounded-lg flex-wrap">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                setError(null);
                setSuccess(null);
              }}
              className={`flex items-center justify-center gap-2 px-3 py-2 rounded-md font-medium transition-colors relative ${
                activeTab === tab.id
                  ? 'bg-accent text-white'
                  : 'text-text-secondary hover:text-white hover:bg-dark-card/50'
              }`}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
              {tab.count !== undefined && tab.count > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Status Messages */}
        {error && (
          <div className="mb-6 p-4 bg-danger/10 border border-danger text-danger rounded-lg flex items-start gap-3">
            <svg className="w-5 h-5 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <div>
              <h3 className="font-medium mb-1">Error</h3>
              <p className="text-sm">{error}</p>
            </div>
          </div>
        )}

        {success && (
          <div className="mb-6 p-4 bg-success/10 border border-success text-success rounded-lg flex items-start gap-3">
            <svg className="w-5 h-5 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <div>
              <h3 className="font-medium mb-1">Success</h3>
              <p className="text-sm">{success}</p>
            </div>
          </div>
        )}

        {/* Tab Content */}
        <div className="bg-dark-card rounded-lg border border-gray-700 p-6">
          {activeTab === 'video' && (
            <form onSubmit={handleSubmitVideo}>
              <div className="mb-6">
                <label htmlFor="videoUrl" className="block text-sm font-medium text-white mb-2">
                  Video URL
                </label>
                <input
                  type="url"
                  id="videoUrl"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                  className="w-full px-4 py-3 bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                  disabled={loading}
                />
                <p className="text-xs text-text-secondary mt-2">
                  Supports YouTube URLs or video IDs
                </p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full btn-primary py-3 font-medium flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <LoadingSpinner size="sm" />
                    Processing...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                    Submit Video Request
                  </>
                )}
              </button>
            </form>
          )}

          {activeTab === 'website' && (
            <form onSubmit={handleSubmitWebsite}>
              <div className="mb-6">
                <label htmlFor="websiteUrl" className="block text-sm font-medium text-white mb-2">
                  Website URL
                </label>
                <input
                  type="url"
                  id="websiteUrl"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  placeholder="https://example.com/article"
                  className="w-full px-4 py-3 bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                  disabled={loading}
                />
                <p className="text-xs text-text-secondary mt-2">
                  Enter the full URL of the website you want to summarize
                </p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full btn-primary py-3 font-medium flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <LoadingSpinner size="sm" />
                    Processing...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                    Submit Website Request
                  </>
                )}
              </button>
            </form>
          )}

          {activeTab === 'custom' && (
            <form onSubmit={handleSubmitCustom}>
              <div className="mb-4">
                <label htmlFor="customTitle" className="block text-sm font-medium text-white mb-2">
                  Title
                </label>
                <input
                  type="text"
                  id="customTitle"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder="Enter a descriptive title"
                  className="w-full px-4 py-3 bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                  disabled={loading}
                />
              </div>

              <div className="mb-6">
                <label htmlFor="customContent" className="block text-sm font-medium text-white mb-2">
                  Content
                </label>
                <textarea
                  id="customContent"
                  value={customContent}
                  onChange={(e) => setCustomContent(e.target.value)}
                  placeholder="Paste or type your content here..."
                  rows={10}
                  className="w-full px-4 py-3 bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 resize-none input-field"
                  disabled={loading}
                />
                <p className="text-xs text-text-secondary mt-2">
                  Enter the text content you want to summarize
                </p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full btn-primary py-3 font-medium flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <LoadingSpinner size="sm" />
                    Processing...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                    Submit Custom Content
                  </>
                )}
              </button>
            </form>
          )}

          {activeTab === 'file' && (
            <div>
              <div className="mb-6">
                <label htmlFor="file-input" className="block text-sm font-medium text-white mb-2">
                  Upload JSON File
                </label>
                <div className="border-2 border-dashed border-gray-700 rounded-lg p-6 text-center hover:border-accent transition-colors">
                  <input
                    id="file-input"
                    type="file"
                    accept=".json,application/json"
                    onChange={handleFileSelect}
                    disabled={loading}
                    className="hidden"
                  />
                  <label
                    htmlFor="file-input"
                    className="cursor-pointer block"
                  >
                    <svg className="mx-auto h-12 w-12 text-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <p className="text-sm text-text-secondary">
                      Click to select a JSON file or drag and drop
                    </p>
                    <p className="text-xs text-text-secondary mt-1">
                      Maximum file size: 5MB
                    </p>
                  </label>
                </div>
              </div>

              {fileInfo && (
                <div className="mb-6 p-4 bg-dark-bg rounded-lg border border-gray-700">
                  <h4 className="font-medium text-white mb-2">Selected File</h4>
                  <div className="space-y-1 text-sm text-text-secondary">
                    <p><span className="font-medium">Name:</span> {fileInfo.name}</p>
                    <p><span className="font-medium">Size:</span> {formatFileSize(fileInfo.size)}</p>
                    <p><span className="font-medium">Records:</span> {fileInfo.recordCount}</p>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={handleFileUpload}
                disabled={loading || !selectedFile}
                className="w-full btn-primary py-3 font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <LoadingSpinner size="sm" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    Upload File
                  </>
                )}
              </button>
            </div>
          )}

          {activeTab === 'progress' && (
            <div>
              {isLoadingProgress ? (
                <div className="flex items-center justify-center py-8">
                  <LoadingSpinner size="lg" />
                </div>
              ) : progressItems.length === 0 ? (
                <div className="text-center py-8">
                  <svg className="mx-auto h-12 w-12 text-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-text-secondary">No items in progress</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {progressItems.map((item) => {
                    const percentage = getProgressPercentage(item.status, item.source_type);
                    const progressColor = getProgressColorClass(percentage);
                    const statusClass = item.status.toLowerCase();
                    
                    return (
                      <div
                        key={item.id}
                        className={`p-4 rounded-lg border ${
                          statusClass === 'failed'
                            ? 'bg-danger/10 border-danger'
                            : statusClass === 'done'
                            ? 'bg-success/10 border-success'
                            : 'bg-dark-bg border-gray-700'
                        }`}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <h4 className="font-medium text-white">{item.title}</h4>
                            <div className="flex items-center gap-2 mt-1">
                              <span className={`text-xs px-2 py-1 rounded-full ${
                                statusClass === 'failed'
                                  ? 'bg-danger text-white'
                                  : statusClass === 'done'
                                  ? 'bg-success text-white'
                                  : 'bg-accent text-white'
                              }`}>
                                {item.status.replace(/_/g, ' ')}
                              </span>
                              <span className="text-xs text-text-secondary capitalize">
                                {item.source_type}
                              </span>
                            </div>
                          </div>
                        </div>

                        {item.status !== 'FAILED' && (
                          <div className="mb-3">
                            <div className="flex justify-between text-xs text-text-secondary mb-1">
                              <span>Progress</span>
                              <span>{percentage}%</span>
                            </div>
                            <div className="h-2 bg-dark-card rounded-full overflow-hidden">
                              <div
                                className={`h-full ${progressColor} transition-all duration-500`}
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                          </div>
                        )}

                        <div className="space-y-1 text-xs text-text-secondary">
                          {item.url && (
                            <div className="flex items-center gap-2">
                              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/>
                              </svg>
                              <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline truncate">
                                {item.url}
                              </a>
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                            </svg>
                            <span>Added by: {item.addedby || 'Unknown'}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
                            </svg>
                            <span>{formatDate(item.date)}</span>
                          </div>
                        </div>

                        {/* Restart Button */}
                        <div className="mt-3 pt-3 border-t border-gray-700">
                          <button
                            onClick={() => handleRestartJob(item.id, item.source_type)}
                            disabled={loading}
                            className="w-full px-3 py-2 text-sm bg-accent/20 text-accent rounded-md hover:bg-accent/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                            Restart Job
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === 'playlist' && (
            <div>
              {isLoadingPlaylist ? (
                <div className="flex items-center justify-center py-8">
                  <LoadingSpinner size="lg" />
                </div>
              ) : playlist ? (
                /* Existing Playlist Display */
                <div className="space-y-4">
                  <div className="p-4 bg-dark-bg rounded-lg border border-gray-700">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h4 className="font-medium text-white">{playlist.playlist_title || 'YouTube Playlist'}</h4>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`text-xs px-2 py-1 rounded-full ${
                            playlist.status === 'active'
                              ? 'bg-success text-white'
                              : playlist.status === 'paused'
                              ? 'bg-yellow-500 text-white'
                              : 'bg-danger text-white'
                          }`}>
                            {playlist.status}
                          </span>
                          <span className="text-xs text-text-secondary">
                            {playlist.video_count} videos
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1 text-xs text-text-secondary mb-4">
                      <div className="flex items-center gap-2">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/>
                        </svg>
                        <a href={playlist.playlist_url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline truncate">
                          {playlist.playlist_url}
                        </a>
                      </div>
                      {playlist.last_sync_at && (
                        <div className="flex items-center gap-2">
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
                          </svg>
                          <span>Last sync: {formatDate(playlist.last_sync_at)}</span>
                        </div>
                      )}
                      {playlist.last_error && (
                        <div className="flex items-center gap-2 text-danger">
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                          </svg>
                          <span className="truncate">{playlist.last_error}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {playlist.status === 'active' && (
                        <button
                          onClick={() => handlePlaylistStatusChange('paused')}
                          disabled={loading}
                          className="px-3 py-2 text-sm bg-yellow-500/20 text-yellow-400 rounded-md hover:bg-yellow-500/30 transition-colors disabled:opacity-50"
                        >
                          Pause
                        </button>
                      )}
                      {playlist.status === 'paused' && (
                        <button
                          onClick={() => handlePlaylistStatusChange('active')}
                          disabled={loading}
                          className="px-3 py-2 text-sm bg-success/20 text-success rounded-md hover:bg-success/30 transition-colors disabled:opacity-50"
                        >
                          Resume
                        </button>
                      )}
                      {playlist.status === 'error' && (
                        <button
                          onClick={() => handlePlaylistStatusChange('active')}
                          disabled={loading}
                          className="px-3 py-2 text-sm bg-accent text-white rounded-md hover:bg-accent/80 transition-colors disabled:opacity-50"
                        >
                          Retry
                        </button>
                      )}
                      <button
                        onClick={handleDeletePlaylist}
                        disabled={loading}
                        className="px-3 py-2 text-sm bg-danger/20 text-danger rounded-md hover:bg-danger/30 transition-colors disabled:opacity-50"
                      >
                        Remove
                      </button>
                      <button
                        onClick={loadPlaylistVideos}
                        disabled={loading}
                        className="px-3 py-2 text-sm bg-gray-700 text-white rounded-md hover:bg-gray-600 transition-colors disabled:opacity-50"
                      >
                        Preview Videos
                      </button>
                    </div>
                  </div>

                  {/* Playlist Videos Preview */}
                  {playlistVideos.length > 0 && (
                    <div className="mt-4">
                      <h4 className="font-medium text-white mb-3">Videos in Playlist</h4>
                      <div className="max-h-64 overflow-y-auto space-y-2">
                        {playlistVideos.slice(0, 20).map((video) => (
                          <div
                            key={video.id}
                            className={`p-3 rounded border ${
                              video.already_imported
                                ? 'bg-success/5 border-success/30'
                                : 'bg-dark-bg border-gray-700'
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-white truncate">{video.title}</p>
                                <p className="text-xs text-text-secondary">{video.channel}</p>
                              </div>
                              {video.already_imported && (
                                <span className="text-xs bg-success/20 text-success px-2 py-1 rounded whitespace-nowrap">
                                  Imported
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                        {playlistVideos.length > 20 && (
                          <p className="text-xs text-text-secondary text-center py-2">
                            And {playlistVideos.length - 20} more videos...
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* Add New Playlist Form */
                <form onSubmit={handleAddPlaylist}>
                  <div className="mb-6">
                    <label htmlFor="playlistUrl" className="block text-sm font-medium text-white mb-2">
                      YouTube Playlist URL
                    </label>
                    <input
                      type="url"
                      id="playlistUrl"
                      value={playlistUrl}
                      onChange={(e) => setPlaylistUrl(e.target.value)}
                      placeholder="https://www.youtube.com/playlist?list=..."
                      className="w-full px-4 py-3 bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                      disabled={loading}
                    />
                    <p className="text-xs text-text-secondary mt-2">
                      Subscribe to a YouTube playlist. New videos will be automatically imported for summarization.
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full btn-primary py-3 font-medium flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <>
                        <LoadingSpinner size="sm" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Subscribe to Playlist
                      </>
                    )}
                  </button>
                </form>
              )}
            </div>
          )}
        </div>

        {/* Info Box */}
        <div className="mt-6 p-4 bg-dark-card rounded-lg border border-gray-700">
          <h3 className="font-medium text-white mb-2 flex items-center gap-2">
            <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            How it works
          </h3>
          <ul className="text-sm text-text-secondary space-y-2">
            <li className="flex items-start gap-2">
              <span className="text-accent mt-1">•</span>
              Submit your content URL or custom text
            </li>
            <li className="flex items-start gap-2">
              <span className="text-accent mt-1">•</span>
              Our system processes the content using AI
            </li>
            <li className="flex items-start gap-2">
              <span className="text-accent mt-1">•</span>
              The summarized content will appear in your library
            </li>
            <li className="flex items-start gap-2">
              <span className="text-accent mt-1">•</span>
              Processing time varies based on content length
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default RequestPage;
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../hooks/useChat';
import { apiFetch } from '../utils/api';
import LoadingSpinner from './Shared/LoadingSpinner';

function ArenaPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const {
    messages,
    inputValue,
    setInputValue,
    isGenerating,
    mode,
    setMode,
    selectedSummaries,
    sendMessage,
    stopGeneration,
    clearChat,
    allSummaries,
    setAllSummaries,
    selectedSummaryCount,
    toggleSummarySelection,
    selectAllSummaries,
    deselectAllSummaries,
    allTags,
    setAllTags,
    selectedTags,
    toggleTagSelection,
    sidebarMode,
    setSidebarMode,
    // WebLLM state
    webGPUSupported,
    isModelLoading,
    modelLoadingProgress,
    modelLoadingText,
    modelLoaded,
    webLLMConfig
  } = useChat();

  const [showPrompts, setShowPrompts] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    // Collapse sidebar on mobile by default
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 768;
    }
    return true;
  });
  const [loadingSummaries, setLoadingSummaries] = useState(true);
  const [loadingTags, setLoadingTags] = useState(false);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/');
    }
  }, [isAuthenticated, navigate]);

  // Fetch all summaries on mount
  useEffect(() => {
    const fetchAllSummaries = async () => {
      try {
        setLoadingSummaries(true);
        
        // Fetch video summaries and custom summaries in parallel
        const [videoRes, customRes] = await Promise.all([
          apiFetch('/api/summaries'),
          apiFetch('/api/summariesCustom')
        ]);
        
        const videoSummaries = videoRes.ok ? await videoRes.json() : [];
        const customSummaries = customRes.ok ? await customRes.json() : [];
        
        // Normalize summaries with _id and type
        const normalizedVideo = videoSummaries.map(s => ({
          ...s,
          _id: s.videoid || s.id,
          type: 'video',
          title: s.name || s.title || 'Untitled'
        }));
        
        const normalizedCustom = customSummaries.map(s => ({
          ...s,
          _id: s.id,
          type: s.source_type || 'custom',
          title: s.title || 'Untitled'
        }));
        
        setAllSummaries([...normalizedVideo, ...normalizedCustom]);
      } catch (err) {
        console.error('Failed to load summaries:', err);
      } finally {
        setLoadingSummaries(false);
      }
    };
    
    fetchAllSummaries();
  }, [setAllSummaries]);

  // Fetch tags when sidebar mode changes to tags
  useEffect(() => {
    const fetchTags = async () => {
      if (sidebarMode !== 'tags' || allTags.length > 0) return;
      
      try {
        setLoadingTags(true);
        const response = await apiFetch('/api/tags');
        if (response.ok) {
          const tags = await response.json();
          setAllTags(tags || []);
        }
      } catch (err) {
        console.error('Failed to load tags:', err);
      } finally {
        setLoadingTags(false);
      }
    };
    
    fetchTags();
  }, [sidebarMode, allTags.length, setAllTags]);

  const handleSend = () => {
    if (inputValue.trim()) {
      sendMessage();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleClearChat = () => {
    if (window.confirm('Are you sure you want to clear the chat history?')) {
      clearChat();
    }
  };

  const prompts = [
    'Summarize all selected content',
    'What are the main similarities between these?',
    'Create a detailed comparison',
    'Extract key insights from each',
    'Generate a combined summary',
    'What are the unique points in each?',
    'Create a study guide from these',
    'Identify trends and patterns',
    'Generate quiz questions based on content',
    'Create a timeline of events'
  ];

  // Filter summaries based on sidebar mode and selections
  const getFilteredSummaries = () => {
    if (sidebarMode === 'tags' && selectedTags.length > 0) {
      return allSummaries.filter(summary => {
        const summaryTags = Array.isArray(summary.tags) 
          ? summary.tags 
          : (typeof summary.tags === 'string' ? summary.tags.split(',').map(t => t.trim()) : []);
        return selectedTags.some(tag => summaryTags.includes(tag));
      });
    }
    return allSummaries;
  };

  const filteredSummaries = getFilteredSummaries();

  return (
    <div className="flex h-screen bg-dark-bg">
      {/* Sidebar - Summary Selection */}
      <div className={`${sidebarOpen ? 'w-80' : 'w-0'} overflow-hidden transition-all duration-300 border-r border-dark-card bg-dark-bg flex-shrink-0`}>
        <div className="h-full flex flex-col p-2 w-80">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Chat Arena</h2>
            <button
              onClick={() => setSidebarOpen(false)}
              className="text-text-secondary hover:text-white transition-colors p-1"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            </button>
          </div>

          {/* Sidebar Mode Toggle */}
          <div className="flex items-center bg-dark-card rounded-lg p-1 mb-4">
            <button
              onClick={() => setSidebarMode('summaries')}
              className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                sidebarMode === 'summaries'
                  ? 'bg-accent text-white'
                  : 'text-text-secondary hover:text-white'
              }`}
            >
              Summaries
            </button>
            <button
              onClick={() => setSidebarMode('tags')}
              className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                sidebarMode === 'tags'
                  ? 'bg-accent text-white'
                  : 'text-text-secondary hover:text-white'
              }`}
            >
              Tags
            </button>
          </div>

          {/* Selection Controls */}
          {sidebarMode === 'summaries' && (
            <div className="flex gap-2 mb-4">
              <button
                onClick={selectAllSummaries}
                disabled={selectedSummaryCount === allSummaries.length}
                className="flex-1 px-3 py-1.5 bg-dark-card text-text-secondary hover:text-white rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-gray-700"
              >
                Select All
              </button>
              <button
                onClick={deselectAllSummaries}
                disabled={selectedSummaryCount === 0}
                className="flex-1 px-3 py-1.5 bg-dark-card text-text-secondary hover:text-white rounded-lg text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-gray-700"
              >
                Deselect All
              </button>
            </div>
          )}

          {/* Selected Count */}
          <div className="text-xs text-text-secondary mb-2">
            {sidebarMode === 'summaries' 
              ? `${selectedSummaryCount} of ${allSummaries.length} summaries selected`
              : `${selectedTags.length} tags selected`
            }
          </div>

          {/* Sidebar Content */}
          <div className="flex-1 overflow-y-auto space-y-2">
            {sidebarMode === 'summaries' ? (
              // Summaries List
              loadingSummaries ? (
                <div className="flex items-center justify-center py-8">
                  <LoadingSpinner size="md" />
                </div>
              ) : filteredSummaries.length === 0 ? (
                <p className="text-text-secondary text-sm text-center py-8">
                  No summaries available.<br />
                  Add some content from the main page.
                </p>
              ) : (
                filteredSummaries.map((summary) => {
                  const isSelected = selectedSummaries[summary._id];
                  return (
                    <div
                      key={summary._id}
                      onClick={() => toggleSummarySelection(summary._id)}
                      className={`p-3 rounded-lg border cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-accent/20 border-accent'
                          : 'bg-dark-card border-gray-700 hover:border-gray-500'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={isSelected || false}
                          onChange={() => toggleSummarySelection(summary._id)}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-1 w-4 h-4 rounded border-gray-600 text-accent focus:ring-accent/50 cursor-pointer"
                        />
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium text-white text-sm line-clamp-2 mb-1">
                            {summary.title}
                          </h3>
                          <p className="text-xs text-text-secondary line-clamp-1">
                            {summary.channel || summary.url || summary.type}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })
              )
            ) : (
              // Tags List
              loadingTags ? (
                <div className="flex items-center justify-center py-8">
                  <LoadingSpinner size="md" />
                </div>
              ) : allTags.length === 0 ? (
                <p className="text-text-secondary text-sm text-center py-8">
                  No tags available.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {allTags.map((tag) => {
                    const isSelected = selectedTags.includes(tag);
                    return (
                      <button
                        key={tag}
                        onClick={() => toggleTagSelection(tag)}
                        className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                          isSelected
                            ? 'bg-accent text-white'
                            : 'bg-dark-card text-text-secondary hover:text-white border border-gray-700'
                        }`}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              )
            )}
          </div>

          {/* Add More Content Button */}
          <div className="mt-4 pt-4 border-t border-gray-700">
            <button
              onClick={() => navigate('/')}
              className="w-full btn-secondary text-sm py-2"
            >
              Add More Content
            </button>
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header - Mobile: 2 rows, Desktop: 1 row */}
        <div className="border-b border-dark-card bg-dark-bg p-3 sm:p-4">
          {/* Row 1: Nav + Title + Clear Chat */}
          <div className="flex items-center gap-2">
            {/* Navigation buttons */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => navigate('/')}
                className="text-text-secondary hover:text-white transition-colors p-1"
                title="Back to Home"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </button>

              {!sidebarOpen && (
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="text-text-secondary hover:text-white transition-colors p-1"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
              )}
            </div>

            {/* Title and subtitle - with truncation */}
            <div className="flex-1 min-w-0">
              <h1 className="text-base sm:text-xl font-bold text-white truncate">Chat Arena</h1>
              <p className="text-xs sm:text-sm text-text-secondary truncate">
                {selectedSummaryCount > 0
                  ? `Analyzing ${selectedSummaryCount} item${selectedSummaryCount !== 1 ? 's' : ''}`
                  : 'Select content to start analyzing'}
              </p>
            </div>

            {/* Clear chat button */}
            <button
              onClick={handleClearChat}
              className="text-text-secondary hover:text-white transition-colors p-2 rounded-lg hover:bg-dark-card flex-shrink-0"
              title="Clear Chat"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>

          {/* Row 2: Mode Toggle - full width on mobile, keep full labels */}
          <div className="flex items-center justify-center sm:justify-end mt-3">
            <div className="flex items-center bg-dark-card rounded-lg p-1 w-full sm:w-auto">
              <button
                onClick={() => setMode('publicai')}
                className={`flex-1 sm:flex-none px-2 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors ${
                  mode === 'publicai'
                    ? 'bg-accent text-white'
                    : 'text-text-secondary hover:text-white'
                }`}
              >
                PublicAi
              </button>
              <button
                onClick={() => setMode('cloud')}
                className={`flex-1 sm:flex-none px-2 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors ${
                  mode === 'cloud'
                    ? 'bg-accent text-white'
                    : 'text-text-secondary hover:text-white'
                }`}
              >
                MyCloud
              </button>
              <button
                onClick={() => setMode('webgpu')}
                className={`flex-1 sm:flex-none px-2 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm font-medium transition-colors ${
                  mode === 'webgpu'
                    ? 'bg-accent text-white'
                    : 'text-text-secondary hover:text-white'
                }`}
              >
                OnDevice
              </button>
            </div>
          </div>
        </div>

        {/* WebGPU Not Supported Warning */}
        {webGPUSupported === false && (
          <div className="mx-4 mt-4 p-4 bg-yellow-900/30 border border-yellow-600/50 rounded-lg">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-yellow-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <h4 className="text-yellow-500 font-medium">OnDevice Mode Not Supported</h4>
                <p className="text-sm text-text-secondary mt-1">
                  Your browser or device doesn't support WebGPU. OnDevice mode requires Chrome 113+ or Edge 113+.
                  Please use PublicAi or MyCloud mode for AI chat.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Model Loading Overlay */}
        {isModelLoading && (
          <div className="mx-4 mt-4 p-6 bg-dark-card border border-accent/30 rounded-lg">
            <div className="flex flex-col items-center text-center">
              <LoadingSpinner size="lg" />
              <h3 className="text-lg font-semibold text-white mt-4">Loading WebLLM Model</h3>
              <p className="text-sm text-text-secondary mt-1 max-w-md">
                {webLLMConfig?.webllm_hf_model_url || 'Loading model...'}
              </p>
              
              {/* Progress Bar */}
              <div className="w-full max-w-sm mt-4">
                <div className="flex justify-between text-xs text-text-secondary mb-1">
                  <span>{modelLoadingText}</span>
                  <span>{modelLoadingProgress}%</span>
                </div>
                <div className="h-2 bg-dark-bg rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-accent transition-all duration-300 rounded-full"
                    style={{ width: `${modelLoadingProgress}%` }}
                  />
                </div>
              </div>
              
              <p className="text-xs text-text-secondary mt-4">
                This may take a few minutes on first load. The model runs entirely in your browser.
              </p>
            </div>
          </div>
        )}

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-16 h-16 mb-4 bg-dark-card rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">
                Start a conversation
              </h3>
              <p className="text-text-secondary max-w-md">
                {selectedSummaryCount > 0
                  ? `Ask questions about your ${selectedSummaryCount} selected item${selectedSummaryCount !== 1 ? 's' : ''}.`
                  : 'Select summaries from the sidebar to start chatting.'}
              </p>
              {mode === 'webgpu' && (
                <div className="mt-4 p-3 bg-dark-card rounded-lg max-w-md">
                  <p className="text-sm text-text-secondary">
                    <span className="text-accent font-medium">WebGPU Mode:</span> 
                    Running models directly in your browser. No data sent to the cloud.
                  </p>
                </div>
              )}
            </div>
          ) : (
            messages.map((message, index) => (
              <div
                key={index}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] p-[10px] rounded-lg ${
                    message.role === 'user'
                      ? 'message-user bg-accent text-white'
                      : 'message-assistant bg-dark-card text-white'
                  }`}
                >
                  <div className="whitespace-pre-wrap">{message.content}</div>
                  {message.reasoning && (
                    <details className="mt-2 text-sm">
                      <summary className="cursor-pointer text-text-secondary hover:text-white">
                        💭 Show Reasoning
                      </summary>
                      <div className="mt-2 p-2 bg-dark-bg rounded text-text-secondary whitespace-pre-wrap">
                        {message.reasoning}
                      </div>
                    </details>
                  )}
                  {message.metrics && (
                    <div className="mt-2 text-xs text-text-secondary">
                      📊 {message.metrics.total_tokens || 0} tokens | {message.metrics.tokens_per_second || '0'} tok/s
                    </div>
                  )}
                  {message.timestamp && (
                    <div className="text-xs mt-2 opacity-70">
                      {new Date(message.timestamp).toLocaleTimeString()}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          {isGenerating && (
            <div className="flex justify-start">
              <div className="message-assistant bg-dark-card text-white p-[10px] rounded-lg">
                <LoadingSpinner size="sm" />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="border-t border-dark-card bg-dark-bg p-4">
          {/* Prompts Dropdown */}
          <div className="relative mb-2">
            <button
              onClick={() => setShowPrompts(!showPrompts)}
              className="flex items-center gap-2 text-sm text-text-secondary hover:text-accent transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Quick Prompts
            </button>
            {showPrompts && (
              <div className="absolute bottom-full left-0 mb-2 w-full bg-dark-card border border-gray-700 rounded-lg shadow-lg overflow-hidden z-10">
                {prompts.map((prompt, index) => (
                  <button
                    key={index}
                    onClick={() => {
                      setInputValue(prompt);
                      setShowPrompts(false);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-text-secondary hover:bg-accent hover:text-white transition-colors first:hover:rounded-t-lg last:hover:rounded-b-lg"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Input Box */}
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={selectedSummaryCount > 0 
                  ? "Ask a question about the selected content..." 
                  : "Select content from sidebar to start chatting..."}
                className="w-full px-4 py-3 bg-dark-card text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 resize-none input-field"
                rows={1}
                disabled={isGenerating || selectedSummaryCount === 0}
              />
            </div>
            {isGenerating ? (
              <button
                onClick={stopGeneration}
                className="px-6 py-3 bg-danger hover:bg-danger/90 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="6" width="12" height="12" rx="1" />
                </svg>
                Stop
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!inputValue.trim() || selectedSummaryCount === 0}
                className="px-6 py-3 bg-accent hover:bg-accent/90 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                Send
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            )}
          </div>
          <p className="text-xs text-text-secondary mt-2 text-center">
            Press Enter to send, Shift+Enter for new line
          </p>
        </div>
      </div>
    </div>
  );
}

export default ArenaPage;
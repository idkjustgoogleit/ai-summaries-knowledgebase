import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';
import LoadingSpinner from './Shared/LoadingSpinner';
import { getThumbnailUrl, getFaviconUrl, normalizeTags, formatDateTimeTZ } from '../utils/helpers';
import TTSPlayer from './summary/TTSPlayer';
import NotesSection from './summary/NotesSection';
import FavoritesToggle from './summary/FavoritesToggle';
import DisplaySections from './summary/DisplaySections';

function SummaryDetailsPage() {
  const { type, id } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated, user, authMode } = useAuth();

  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notes, setNotes] = useState('');

  // Collapsible sections state
  const [expandedSections, setExpandedSections] = useState({
    tldr: true,
    description: false,
    summary: false,
    keyInsights: false,
    actionableTakeaways: false,
    notes: false
  });

  // Inline chat state
  const [showInlineChat, setShowInlineChat] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatMode, setChatMode] = useState('publicai'); // 'publicai', 'cloud', 'webgpu'
  const chatEndRef = useRef(null);

  useEffect(() => {
    fetchSummaryDetails();
  }, [type, id]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, showInlineChat]);

  // Helper to determine the correct API endpoint based on source type
  const getApiEndpoint = () => {
    if (type === 'video') {
      return `/api/summaries/type/video/${id}`;
    } else if (type === 'website') {
      return `/api/summaries/type/website/${id}`;
    } else if (type === 'custom') {
      return `/api/summaries/type/custom/${id}`;
    }
    return null;
  };

  const fetchSummaryDetails = async () => {
    try {
      setLoading(true);
      setError(null);

      const endpoint = getApiEndpoint();

      if (!endpoint) {
        setError('Invalid summary type');
        setLoading(false);
        return;
      }

      const response = await apiFetch(endpoint);

      if (!response.ok) {
        throw new Error('Failed to load summary details');
      }

      const summaryData = await response.json();
      setSummary(summaryData);
      setNotes(summaryData.notes || '');
    } catch (err) {
      console.error('Error fetching summary details:', err);
      setError(err.message || 'An error occurred while loading summary');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  // Export Functions
  const formatContentForTTS = (content) => {
    // Handle arrays, objects, or strings
    if (Array.isArray(content)) {
      return content.map((item, index) => `${index + 1}. ${item}`).join('\n');
    }
    if (typeof content === 'object' && content !== null) {
      return Object.entries(content).map(([key, value]) => `${key}: ${value}`).join('\n');
    }
    return String(content);
  };

  const handleExportText = () => {
    const textContent = `Title: ${summary.title}\n\n` +
      `TL;DR: ${summary.tldr || 'N/A'}\n\n` +
      `Description:\n${summary.description || 'N/A'}\n\n` +
      `Summary:\n${summary.summary || summary.summary_text || summary.content || 'N/A'}\n\n` +
      `Key Insights:\n${formatContentForTTS(summary.key_insights) || 'N/A'}\n\n` +
      `Actionable Takeaways:\n${formatContentForTTS(summary.actionable_takeaways) || 'N/A'}\n\n` +
      `Notes:\n${notes || 'N/A'}`;

    const blob = new Blob([textContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${summary.title.replace(/[^a-z0-9]/gi, '_')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleShare = async () => {
    const shareData = {
      title: summary.title,
      text: summary.tldr || summary.title,
      url: window.location.href
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(window.location.href);
        alert('URL copied to clipboard!');
      }
    } catch (err) {
      console.error('Share failed:', err);
    }
  };

  // Delete Function
  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete this summary? This action cannot be undone.')) {
      return;
    }

    try {
      const endpoint = type === 'custom'
        ? `/api/summariesCustom/${id}`
        : `/api/summaries/${id}`;

      const response = await apiFetch(endpoint, { method: 'DELETE' });

      if (!response.ok) {
        throw new Error('Failed to delete summary');
      }

      alert('Summary deleted successfully');
      navigate('/');
    } catch (err) {
      console.error('Failed to delete summary:', err);
      alert(err.message || 'Failed to delete summary');
    }
  };

  // Chat Functions
  const handleChatWithContent = () => {
    setShowInlineChat(true);
  };

  const handleSendChatMessage = async () => {
    if (!chatInput.trim() || chatLoading) return;

    const userMessage = chatInput;
    setChatInput('');
    setChatLoading(true);

    // Add user message
    setChatMessages(prev => [...prev, { role: 'user', content: userMessage }]);

    try {
      let endpoint;
      let requestBody;

      // Build request body based on summary type with correct field names
      if (type === 'video') {
        endpoint = '/api/chat/ask';
        requestBody = {
          videoId: id,
          prompt: userMessage,
          mode: chatMode
        };
      } else if (type === 'website') {
        endpoint = '/api/chat/ask-website-summary';
        requestBody = {
          websiteId: id,
          prompt: userMessage,
          mode: chatMode
        };
      } else if (type === 'custom') {
        endpoint = '/api/chat/ask-custom-summary';
        requestBody = {
          summaryId: id,
          prompt: userMessage,
          mode: chatMode
        };
      }

      const response = await apiFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      // Check if response is SSE stream
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('text/event-stream')) {
        // Handle SSE streaming
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullAnswer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop(); // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.substring(6));

                // Handle final completion message
                if (data.isComplete) {
                  fullAnswer = data.answer || data.mainContent || '';
                }
              } catch (e) {
                // Skip malformed JSON
                console.warn('SSE parse error:', e.message);
              }
            }
          }
        }

        setChatMessages(prev => [...prev, {
          role: 'assistant',
          content: fullAnswer || 'No response received'
        }]);
      } else {
        // Handle regular JSON response (fallback for non-streaming)
        const data = await response.json();
        setChatMessages(prev => [...prev, {
          role: 'assistant',
          content: data.answer || data.response || 'No response received'
        }]);
      }
    } catch (err) {
      console.error('Chat error:', err);
      setChatMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, there was an error processing your request.'
      }]);
    } finally {
      setChatLoading(false);
    }
  };

  // Render content based on type (array, object, string)
  const renderContent = (content) => {
    if (!content) return <span className="text-text-secondary">No content available</span>;

    // Handle arrays first (before string checks)
    if (Array.isArray(content)) {
      return formatArrayContent(content);
    }

    // Handle objects (before string checks)
    if (typeof content === 'object' && content !== null) {
      return formatObjectContent(content);
    }

    // Handle strings
    if (typeof content === 'string') {
      let trimmed = content.trim();
      // Remove backslashes (like old implementation)
      trimmed = trimmed.replace(/\\/g, '');

      // Check for JSON array
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            return formatArrayContent(parsed);
          }
        } catch (e) {
          // Parse error expected for malformed JSON, fallback to plain text
        }
      }

      // Check for JSON object
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          const parsed = JSON.parse(trimmed);
          return formatObjectContent(parsed);
        } catch (e) {
          // Parse error expected for malformed JSON, try malformed object parsing
          const result = formatMalformedObject(trimmed);
          if (result) return result;
        }
      }
    }

    // Fallback to plain text formatting
    return formatPlainTextContent(content);
  };

  // Format array content (from old implementation)
  const formatArrayContent = (array) => {
    if (!Array.isArray(array) || array.length === 0) return <span className="text-text-secondary">No content available</span>;

    return (
      <ul className="list-disc list-inside space-y-2">
        {array.map((item, index) => {
          if (typeof item === 'string') {
            let cleanItem = item.replace(/^["']|["']$/g, '').trim();
            return (
              <li key={index} className="text-white whitespace-pre-wrap break-words">
                {cleanItem}
              </li>
            );
          } else if (typeof item === 'object' && item !== null) {
            let text = item.text || item.content || item.title || JSON.stringify(item);
            return (
              <li key={index} className="text-white whitespace-pre-wrap break-words">
                {String(text)}
              </li>
            );
          } else {
            return (
              <li key={index} className="text-white whitespace-pre-wrap break-words">
                {String(item)}
              </li>
            );
          }
        })}
      </ul>
    );
  };

  // Format object content (from old implementation)
  const formatObjectContent = (obj) => {
    if (typeof obj !== 'object' || obj === null) return <span className="text-text-secondary">No content available</span>;

    // Check if object has items array
    if (obj.items && Array.isArray(obj.items)) {
      return formatArrayContent(obj.items);
    }

    // Check if all keys are numeric (like array-like object)
    if (Object.keys(obj).every(key => /^\d+$/.test(key))) {
      const array = Object.keys(obj)
        .sort((a, b) => parseInt(a) - parseInt(b))
        .map(key => obj[key]);
      return formatArrayContent(array);
    }

    return (
      <ul className="list-disc list-inside space-y-2">
        {Object.entries(obj).map(([key, value]) => (
          <li key={key} className="text-white whitespace-pre-wrap break-words">
            <span className="font-semibold">{key}:</span> {typeof value === 'object' ? JSON.stringify(value) : String(value)}
          </li>
        ))}
      </ul>
    );
  };

  // Format malformed object (from old implementation)
  const formatMalformedObject = (content) => {
    try {
      let innerContent = content.substring(1, content.length - 1);
      let items = [];
      let currentItem = '';
      let inQuotes = false;
      let quoteChar = '';

      for (let i = 0; i < innerContent.length; i++) {
        const char = innerContent[i];
        if ((char === '"' || char === "'") && !inQuotes) {
          inQuotes = true;
          quoteChar = char;
        } else if (char === quoteChar && inQuotes) {
          inQuotes = false;
        } else if (char === ',' && !inQuotes) {
          items.push(currentItem.trim());
          currentItem = '';
        } else {
          currentItem += char;
        }
      }
      if (currentItem.trim()) {
        items.push(currentItem.trim());
      }

      items = items
        .map(item => item.replace(/^["']|["']$/g, '').trim())
        .filter(item => item);

      if (items.length > 0) {
        return (
          <ul className="list-disc list-inside space-y-2">
            {items.map((item, index) => (
              <li key={index} className="text-white whitespace-pre-wrap break-words">
                {item}
              </li>
            ))}
          </ul>
        );
      }
    } catch (e) {
      // Parse error expected, return null
    }
    return null;
  };

  // Format plain text content (from old implementation)
  const formatPlainTextContent = (content) => {
    if (!content) return <span className="text-text-secondary">No content available</span>;

    // Ensure content is a string
    if (typeof content !== 'string') {
      content = String(content);
    }

    // Split by newlines and render as list (like old implementation)
    const lines = content.split('\n');
    return (
      <ul className="list-disc list-inside space-y-2">
        {lines.map((line, index) => {
          line = line.trim();
          if (!line) return null;

          // Handle bullet points, numbered lists, or plain text
          if (line.startsWith('- ') || line.startsWith('* ') || line.startsWith('• ')) {
            const text = line.substring(2).trim();
            return (
              <li key={index} className="text-white whitespace-pre-wrap break-words">
                {text}
              </li>
            );
          } else if (line.match(/^\d+\./)) {
            const text = line.substring(line.indexOf('.') + 1).trim();
            return (
              <li key={index} className="text-white whitespace-pre-wrap break-words">
                {text}
              </li>
            );
          } else {
            return (
              <li key={index} className="text-white whitespace-pre-wrap break-words">
                {line}
              </li>
            );
          }
        })}
      </ul>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-dark-bg flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="min-h-screen bg-dark-bg">
        <div className="container mx-auto p-1 max-w-4xl sm:p-8">
          <button
            onClick={() => navigate('/')}
            className="mb-6 flex items-center gap-2 text-text-secondary hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Summaries
          </button>

          <div className="bg-dark-card rounded-lg border border-danger p-8 text-center">
            <svg className="w-16 h-16 text-danger mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <h2 className="text-xl font-bold text-white mb-2">Error Loading Summary</h2>
            <p className="text-text-secondary mb-4">{error || 'Summary not found'}</p>
            <button
              onClick={() => navigate('/')}
              className="px-6 py-2 btn-primary"
            >
              Return Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Generate thumbnail and favicon based on type
  let thumbnailUrl = null;
  let faviconUrl = null;

  if (type === 'video' && summary.videoid) {
    thumbnailUrl = getThumbnailUrl(summary.videoid);
  } else if (type === 'website' && summary.url) {
    try {
      const url = new URL(summary.url);
      faviconUrl = getFaviconUrl(url.hostname);
    } catch (e) {
      // Invalid URL, skip favicon
    }
  }

  // Normalize tags
  const tags = normalizeTags(summary.tags);

  // Check if user can delete (owner or admin)
  const canDelete = isAuthenticated && (
    authMode === 'local' ||
    summary.addedby === user?.sub ||
    user?.role === 'admin'
  );

  return (
    <div className="min-h-screen bg-dark-bg">
      <div className="container mx-auto p-1 max-w-4xl sm:p-8">
        {/* Back Button */}
        <button
          onClick={() => navigate('/')}
          className="mb-6 flex items-center gap-2 text-text-secondary hover:text-white transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Summaries
        </button>

        <div className="bg-dark-card rounded-lg border border-gray-700 overflow-hidden">
          {/* Header */}
          <div className="p-6 border-b border-gray-700">
            {/* Thumbnail - ABOVE title, large and centered */}
            {thumbnailUrl && (
              <div className="mb-6 flex justify-center">
                <img
                  src={thumbnailUrl}
                  alt={summary.title}
                  className="w-full max-w-2xl h-auto rounded-lg"
                />
              </div>
            )}

            {/* Title and Actions */}
            <div>
              <h1 className="text-2xl font-bold text-white mb-4">{summary.title}</h1>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 flex-wrap">
                {/* TTS Player */}
                <TTSPlayer summary={summary} />

                {/* Share */}
                <button
                  onClick={handleShare}
                  className="p-2 rounded-lg hover:bg-dark-card transition-colors border border-gray-700"
                  title="Share summary"
                >
                  <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                </button>

                {/* Export */}
                <button
                  onClick={handleExportText}
                  className="p-2 rounded-lg hover:bg-dark-card transition-colors border border-gray-700"
                  title="Export as text"
                >
                  <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </button>

                {/* Chat */}
                <button
                  onClick={handleChatWithContent}
                  className="p-2 rounded-lg hover:bg-dark-card transition-colors border border-gray-700"
                  title="Chat with content"
                >
                  <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </button>

                {/* Favorite */}
                <FavoritesToggle
                  summaryId={id}
                  summaryType={type}
                  isAuthenticated={isAuthenticated}
                  initialFavorited={summary.isFavorite || false}
                />

                {/* Delete */}
                {canDelete && (
                  <button
                    onClick={handleDelete}
                    className="p-2 rounded-lg hover:bg-danger/20 transition-colors border border-gray-700"
                    title="Delete summary"
                  >
                    <svg className="w-5 h-5 text-danger" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Content Sections */}
        <div className="mt-6">
          {/* Main Display Sections */}
          <DisplaySections
            summary={summary}
            expandedSections={expandedSections}
            onToggleSection={handleToggleSection}
            renderContent={renderContent}
          />

          {/* Notes Section */}
          <NotesSection
            summaryId={id}
            summaryType={type}
            initialNotes={notes}
            isAuthenticated={isAuthenticated}
            expanded={expandedSections.notes}
            onToggle={() => handleToggleSection('notes')}
          />

          {/* Metadata */}
          <div className="bg-dark-card rounded-lg border border-gray-700 p-6 mb-6">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Metadata
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h4 className="text-sm font-medium text-text-secondary mb-1">Created</h4>
                <p className="text-white">{formatDateTimeTZ(summary.date_created)}</p>
              </div>

              <div>
                <h4 className="text-sm font-medium text-text-secondary mb-1">Last Updated</h4>
                <p className="text-white">{formatDateTimeTZ(summary.date_update || summary.last_modified)}</p>
              </div>

              {summary.duration && (
                <div>
                  <h4 className="text-sm font-medium text-text-secondary mb-1">Duration</h4>
                  <p className="text-white">
                    {Math.floor(summary.duration / 60)}:{(summary.duration % 60).toString().padStart(2, '0')}
                  </p>
                </div>
              )}

              {summary.word_count && (
                <div>
                  <h4 className="text-sm font-medium text-text-secondary mb-1">Word Count</h4>
                  <p className="text-white">{summary.word_count.toLocaleString()} words</p>
                </div>
              )}

              {summary.confidence && (
                <div>
                  <h4 className="text-sm font-medium text-text-secondary mb-1">Confidence Score</h4>
                  <p className="text-white capitalize">{summary.confidence}</p>
                </div>
              )}

              <div>
                <h4 className="text-sm font-medium text-text-secondary mb-1">Added By</h4>
                <p className="text-white">{summary.addedby || 'Unknown'}</p>
              </div>
            </div>
          </div>

          {/* Tags */}
          {tags.length > 0 && (
            <div className="bg-dark-card rounded-lg border border-gray-700 p-6 mb-6">
              <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
                <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
                Tags
              </h3>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag, index) => (
                  <span
                    key={index}
                    className="px-3 py-1 bg-dark-bg text-text-secondary text-sm rounded-full border border-gray-700"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Inline Chat Panel */}
      {showInlineChat && (
        <div className="fixed bottom-0 left-0 right-0 bg-dark-card border-t border-gray-700 shadow-2xl z-50">
          <div className="container mx-auto max-w-4xl">
            <div className="p-6">
              {/* Chat Header */}
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  Chat with {type === 'video' ? 'Video Data' : 'Summary'}
                </h3>
                <div className="flex items-center gap-2">
                  {/* Chat Mode Selector */}
                  <div className="flex items-center bg-dark-bg rounded-lg p-1">
                    <button
                      onClick={() => setChatMode('publicai')}
                      className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                        chatMode === 'publicai'
                          ? 'bg-accent text-white'
                          : 'text-text-secondary hover:text-white'
                      }`}
                    >
                      PublicAi
                    </button>
                    <button
                      onClick={() => setChatMode('cloud')}
                      className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                        chatMode === 'cloud'
                          ? 'bg-accent text-white'
                          : 'text-text-secondary hover:text-white'
                      }`}
                    >
                      MyCloud
                    </button>
                    <button
                      onClick={() => setChatMode('webgpu')}
                      className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                        chatMode === 'webgpu'
                          ? 'bg-accent text-white'
                          : 'text-text-secondary hover:text-white'
                      }`}
                    >
                      OnDevice
                    </button>
                  </div>
                  <button
                    onClick={() => setShowInlineChat(false)}
                    className="text-text-secondary hover:text-white transition-colors"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Chat Messages */}
              <div className="h-64 overflow-y-auto mb-4 bg-dark-bg rounded-lg p-4 space-y-3">
                {chatMessages.length === 0 ? (
                  <div className="text-center text-text-secondary py-8">
                    <p>Ask questions about this {type === 'video' ? 'video' : 'summary'}</p>
                  </div>
                ) : (
                  chatMessages.map((msg, index) => (
                    <div
                      key={index}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-lg px-4 py-2 ${
                          msg.role === 'user'
                            ? 'bg-accent text-white'
                            : 'bg-gray-700 text-white'
                        }`}
                      >
                        {msg.content}
                      </div>
                    </div>
                  ))
                )}
                {chatLoading && (
                  <div className="flex justify-start">
                    <div className="bg-gray-700 rounded-lg px-4 py-2">
                      <LoadingSpinner size="sm" />
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Chat Input */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendChatMessage()}
                  placeholder={`Ask about this ${type === 'video' ? 'video' : 'summary'}...`}
                  className="flex-1 px-4 py-2 bg-dark-bg border border-gray-700 rounded-lg text-white placeholder-text-secondary focus:outline-none focus:border-accent"
                  disabled={chatLoading}
                />
                <button
                  onClick={handleSendChatMessage}
                  disabled={chatLoading || !chatInput.trim()}
                  className="px-6 py-2 btn-primary disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SummaryDetailsPage;

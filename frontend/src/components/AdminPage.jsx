import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../utils/api';
import LoadingSpinner from './Shared/LoadingSpinner';

// CollapsibleSection component for configuration sections
const CollapsibleSection = ({ title, icon, defaultOpen = false, children }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="bg-dark-card rounded-lg border border-gray-700 overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-dark-bg transition-colors"
      >
        <div className="flex items-center gap-3">
          {icon}
          <h2 className="text-xl font-bold text-white">{title}</h2>
        </div>
        <svg
          className={`w-5 h-5 text-white transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && <div className="p-6 border-t border-gray-700">{children}</div>}
    </div>
  );
};

function AdminPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isAdmin, authMode, user, refreshAuth } = useAuth();
  
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [activeTab, setActiveTab] = useState('config');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  
  // Admin data state for tables
  const [videoImports, setVideoImports] = useState([]);
  const [videoSummaries, setVideoSummaries] = useState([]);
  const [websiteSummaries, setWebsiteSummaries] = useState([]);
  const [customSummaries, setCustomSummaries] = useState([]);
  
  // Table loading states
  const [loadingVideoImports, setLoadingVideoImports] = useState(false);
  const [loadingVideoSummaries, setLoadingVideoSummaries] = useState(false);
  const [loadingWebsiteSummaries, setLoadingWebsiteSummaries] = useState(false);
  const [loadingCustomSummaries, setLoadingCustomSummaries] = useState(false);
  
  // Table search/filter states
  const [videoImportsSearch, setVideoImportsSearch] = useState('');
  const [videoImportsStatusFilter, setVideoImportsStatusFilter] = useState('');
  const [videoSummariesSearch, setVideoSummariesSearch] = useState('');
  const [videoSummariesStatusFilter, setVideoSummariesStatusFilter] = useState('');
  const [websiteSummariesSearch, setWebsiteSummariesSearch] = useState('');
  const [websiteSummariesStatusFilter, setWebsiteSummariesStatusFilter] = useState('');
  const [customSummariesSearch, setCustomSummariesSearch] = useState('');
  const [customSummariesStatusFilter, setCustomSummariesStatusFilter] = useState('');
  
  // Configuration state with all fields - using CAMELCASE keys
  const [config, setConfig] = useState({
    // Worker timing
    importCheckerIntervalMinutes: 5,
    summaryProcessorIntervalMinutes: 4,
    summaryProcessorItemDelaySeconds: 60,
    summaryProcessorDelaySeconds: 75,
    summaryRetryDelaySeconds: 60,
    openaiTimeoutMinutes: 3,
    // AI prompts - will be stored as JSON objects
    summarySystemPrompt: '',
    websiteSummarySystemPrompt: '',
    customSummarySystemPrompt: '',
    // Chunking
    enableChunking: true,
    maxContextWindow: 8000,
    chunkOverlapSize: 500,
    chunkingStrategy: 'simple',
    // Chat AI configuration
    chatOpenaiApiUrl: 'https://api.openai.com/v1/chat/completions',
    chatOpenaiModel: 'gpt-4o-mini',
    chatOpenaiSystemPrompt: '',
    chatOpenaiApiKey: '',
    // PublicAI configuration (NEW)
    chatPublicaiApiUrl: '',
    chatPublicaiModel: '',
    chatPublicaiApiKey: '',
    chatPublicaiSystemPrompt: '',
    // Chat Enhancement configuration (NEW)
    chatStreamWithReasoning: true,
    chatIncludeMetrics: true,
    chatDebugReasoning: false,
    chatReasoningFormat: 'deepseek',
    // Summarizing AI configuration
    summaryOpenaiApiUrl: 'https://api.openai.com/v1/chat/completions',
    summaryOpenaiModel: 'gpt-4o-mini',
    summaryOpenaiApiKey: '',
    summaryOpenaiFailoverEnabled: true,
    summaryOpenaiFailoverMode: 'failover',
    summaryOpenaiFailoverTimeoutSeconds: 60,
    summaryOpenaiSecondaryApiUrl: '',
    summaryOpenaiSecondaryApiKey: '',
    summaryOpenaiSecondaryModel: '',
    // WebLLM configuration
    webllmEnabled: false,
    webllmHfModelUrl: 'HF://mlc-ai/Qwen3-0.6B-q4f16_1-MLC',
    webllmDefaultMode: 'cloud',
    // WebLLM System Prompt (NEW)
    webllmSystemPrompt: '',
    // YouTube Worker configuration
    ytDlpItemDelaySeconds: 120,
    pythonProviderTimeoutMinutes: 45,  // 2700 seconds = 45 minutes
    ytDlpFailedJobRetryHours: 24,  // Hours to wait before retrying failed jobs (0 = disabled)
    // Proxy Rotation configuration
    ytDlpProxyEnabled: true,
    ytDlpProxyType: 'free',
    ytDlpProxyMinPoolSize: 3,
    ytDlpProxyPoolSize: 20,
    ytDlpProxyMaxTestAttempts: 50,
    ytDlpProxyMaxRetries: 5,
    ytDlpProxyMinBackoff: 10,
    ytDlpProxyMaxBackoff: 60,
    ytDlpProxyPaidApiKey: '',
    ytDlpProxyPaidEndpoint: '',
    ytDlpProxyTestYoutubeDirectly: true,
    ytDlpProxyMaxResponseTime: 5,
    ytDlpProxyBlockedPorts: '3128,3129,8080,8888',
    ytDlpProxyEnableHttpsFallback: true,
    // Playlist Worker configuration
    playlistCheckerIntervalMinutes: 60,
    playlistMaxNewVideosPerSync: 10,
    // Security configuration
    rateLimitMax: 1000
  });
  
  const [saving, setSaving] = useState(false);
  const [cookiesUploaded, setCookiesUploaded] = useState(false);

  // Check admin status on mount
  useEffect(() => {
    checkAdminAccess();
  }, []);

  const checkAdminAccess = async () => {
    try {
      setLoading(true);
      
      // Redirect if not authenticated
      if (!isAuthenticated) {
        navigate('/');
        return;
      }
      
      // Check if user has admin rights
      if (!isAdmin) {
        setAccessDenied(true);
        return;
      }
      
      // Admin user - load initial data
      loadConfig();
    } catch (err) {
      setError('Failed to check admin access: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // Helper function to convert snake_case to camelCase
  const toCamelCase = (str) => {
    return str.replace(/_([a-z])/g, (match, letter) => letter.toUpperCase());
  };

  const loadConfig = async () => {
    try {
      const response = await apiFetch('/api/admin/config');
      if (response.ok) {
        const data = await response.json();
        
        // Transform snake_case keys to camelCase and handle nested JSON objects
        const transformedData = {};
        for (const [key, value] of Object.entries(data)) {
          // Convert snake_case to camelCase
          const camelCaseKey = toCamelCase(key);
          
          // Handle prompt fields that may be JSON objects or plain text
          if (key === 'summary_system_prompt' || key === 'website_summary_system_prompt' || key === 'custom_summary_system_prompt') {
            // If it's a JSON object with system_prompt property, extract it
            if (typeof value === 'object' && value !== null && value.system_prompt) {
              transformedData[camelCaseKey] = value.system_prompt;
            } else if (typeof value === 'string') {
              // Handle plain string values (backward compatibility)
              transformedData[camelCaseKey] = value;
            } else {
              console.warn(`[AdminPage] ${key} has unexpected type:`, typeof value);
              transformedData[camelCaseKey] = '';
            }
          } else {
            // Convert python_provider_timeout_seconds from seconds to minutes
            if (key === 'python_provider_timeout_seconds') {
              transformedData[camelCaseKey] = Math.floor(parseInt(value, 10) / 60);
            } else {
              transformedData[camelCaseKey] = value;
            }
          }
        }
        
        setConfig(prevConfig => ({
          ...prevConfig,
          ...transformedData
        }));
      } else {
        setError('Failed to load configuration');
      }
    } catch (err) {
      console.error('[AdminPage] Load config error:', err);
      setError(err.message || 'An error occurred');
    }
  };

  const handleSaveConfig = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      // Transform camelCase keys back to snake_case and wrap prompts in JSON objects
      const transformedData = {};
      for (const [key, value] of Object.entries(config)) {
        // Convert camelCase to snake_case
        const snakeCaseKey = key.replace(/([A-Z])/g, (match, letter) => `_${letter.toLowerCase()}`);
        
        // Handle prompt fields - wrap in JSON objects (as per old implementation)
        if (key === 'summarySystemPrompt' || key === 'websiteSummarySystemPrompt' || key === 'customSummarySystemPrompt') {
          transformedData[snakeCaseKey] = { system_prompt: value };
        } else if (key === 'pythonProviderTimeoutMinutes') {
          // Convert minutes to seconds for python_provider_timeout_seconds
          // Ensure value is a valid number before conversion
          const numValue = parseInt(value, 10);
          if (!isNaN(numValue) && numValue > 0) {
            transformedData['python_provider_timeout_seconds'] = numValue * 60;
          }
        } else if (key === 'rateLimitMax') {
          // Ensure rate_limit_max is sent as a number
          const numValue = parseInt(value, 10);
          if (!isNaN(numValue) && numValue >= 100 && numValue <= 10000) {
            transformedData['rate_limit_max'] = numValue;
          }
        } else if (key === 'pythonProviderTimeoutSeconds') {
          // Skip - this key is generated from pythonProviderTimeoutMinutes
          // Prevents duplicate/invalid values from being sent to backend
          continue;
        } else {
          // Skip keys with undefined, null, or empty values to prevent validation errors
          if (value !== undefined && value !== null && value !== '') {
            transformedData[snakeCaseKey] = value;
          }
        }
      }
      
      const response = await apiFetch('/api/admin/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(transformedData),
      });

      if (response.ok) {
        setSuccess('Configuration saved successfully!');
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error('[AdminPage] Save error response:', errorData);
        // Show validation details if available
        if (errorData.details && Array.isArray(errorData.details) && errorData.details.length > 0) {
          setError('Failed to save configuration: ' + errorData.details.join('; '));
        } else {
          setError('Failed to save configuration: ' + (errorData.error || 'Unknown error'));
        }
      }
    } catch (err) {
      console.error('[AdminPage] Save config error:', err);
      setError(err.message || 'An error occurred while saving');
    } finally {
      setSaving(false);
    }
  };

  const handleCookiesUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('cookies', file);

    try {
      const response = await apiFetch('/api/admin/config/cookies', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        setCookiesUploaded(true);
        setSuccess('Cookies file uploaded successfully!');
        setTimeout(() => setCookiesUploaded(false), 3000);
      } else {
        const errorData = await response.json().catch(() => ({}));
        setError('Failed to upload cookies: ' + (errorData.error || 'Unknown error'));
      }
    } catch (err) {
      console.error('[AdminPage] Cookies upload error:', err);
      setError(err.message || 'An error occurred while uploading cookies');
    }
  };

  // Table data loading functions
  const loadVideoImports = async () => {
    setLoadingVideoImports(true);
    try {
      const response = await apiFetch('/api/import');
      if (response.ok) {
        const data = await response.json();
        setVideoImports(data);
      } else {
        setError('Failed to load video imports');
      }
    } catch (err) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoadingVideoImports(false);
    }
  };

  const loadVideoSummaries = async () => {
    setLoadingVideoSummaries(true);
    try {
      const response = await apiFetch('/api/summaries');
      if (response.ok) {
        const data = await response.json();
        // Filter for video summaries only
        setVideoSummaries(data.filter(s => s.source_type === 'video'));
      } else {
        setError('Failed to load video summaries');
      }
    } catch (err) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoadingVideoSummaries(false);
    }
  };

  const loadWebsiteSummaries = async () => {
    setLoadingWebsiteSummaries(true);
    try {
      const response = await apiFetch('/api/summaries/websites');
      if (response.ok) {
        const data = await response.json();
        setWebsiteSummaries(data);
      } else {
        setError('Failed to load website summaries');
      }
    } catch (err) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoadingWebsiteSummaries(false);
    }
  };

  const loadCustomSummaries = async () => {
    setLoadingCustomSummaries(true);
    try {
      const response = await apiFetch('/api/summariesCustom');
      if (response.ok) {
        const data = await response.json();
        setCustomSummaries(data);
      } else {
        setError('Failed to load custom summaries');
      }
    } catch (err) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoadingCustomSummaries(false);
    }
  };

  // Status update handlers
  const handleVideoImportStatusChange = async (id, newStatus) => {
    try {
      const response = await apiFetch(`/api/import/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      if (response.ok) {
        setSuccess('Status updated successfully');
        loadVideoImports();
      } else {
        setError('Failed to update status');
      }
    } catch (err) {
      setError(err.message || 'An error occurred');
    }
  };

  const handleVideoSummaryStatusChange = async (id, newStatus) => {
    try {
      const response = await apiFetch(`/api/summaries/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      if (response.ok) {
        setSuccess('Status updated successfully');
        loadVideoSummaries();
      } else {
        setError('Failed to update status');
      }
    } catch (err) {
      setError(err.message || 'An error occurred');
    }
  };

  const handleWebsiteSummaryStatusChange = async (id, newStatus) => {
    try {
      const response = await apiFetch(`/api/summaries/websites/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      if (response.ok) {
        setSuccess('Status updated successfully');
        loadWebsiteSummaries();
      } else {
        setError('Failed to update status');
      }
    } catch (err) {
      setError(err.message || 'An error occurred');
    }
  };

  const handleCustomSummaryStatusChange = async (id, newStatus) => {
    try {
      const response = await apiFetch(`/api/summariesCustom/${id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      if (response.ok) {
        setSuccess('Status updated successfully');
        loadCustomSummaries();
      } else {
        setError('Failed to update status');
      }
    } catch (err) {
      setError(err.message || 'An error occurred');
    }
  };

  // Delete handlers
  const handleDeleteVideoImport = async (id) => {
    if (!confirm('Are you sure you want to delete this video import? This action cannot be undone.')) return;
    
    try {
      const response = await apiFetch(`/api/import/${id}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        setSuccess('Video import deleted successfully');
        loadVideoImports();
      } else {
        setError('Failed to delete video import');
      }
    } catch (err) {
      setError(err.message || 'An error occurred');
    }
  };

  const handleDeleteVideoSummary = async (id) => {
    if (!confirm('Are you sure you want to delete this video summary? This action cannot be undone.')) return;
    
    try {
      const response = await apiFetch(`/api/summaries/${id}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        setSuccess('Video summary deleted successfully');
        loadVideoSummaries();
      } else {
        setError('Failed to delete video summary');
      }
    } catch (err) {
      setError(err.message || 'An error occurred');
    }
  };

  const handleDeleteWebsiteSummary = async (id) => {
    if (!confirm('Are you sure you want to delete this website summary? This action cannot be undone.')) return;
    
    try {
      const response = await apiFetch(`/api/summaries/websites/${id}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        setSuccess('Website summary deleted successfully');
        loadWebsiteSummaries();
      } else {
        setError('Failed to delete website summary');
      }
    } catch (err) {
      setError(err.message || 'An error occurred');
    }
  };

  const handleDeleteCustomSummary = async (id) => {
    if (!confirm('Are you sure you want to delete this custom summary? This action cannot be undone.')) return;
    
    try {
      const response = await apiFetch(`/api/summariesCustom/${id}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        setSuccess('Custom summary deleted successfully');
        loadCustomSummaries();
      } else {
        setError('Failed to delete custom summary');
      }
    } catch (err) {
      setError(err.message || 'An error occurred');
    }
  };

  const tabs = [
    { id: 'config', label: 'Configuration', icon: (
      <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    )},
    { id: 'video-imports', label: 'Video Imports', icon: (
      <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    )},
    { id: 'video-summaries', label: 'Video Summaries', icon: (
      <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    )},
    { id: 'website-summaries', label: 'Website Summaries', icon: (
      <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-4.03 3-9 3m0 0a9 9 0 019-9m-9 9a9 9 0 019-9m-9 9c1.657 0 3 4.03 3 9s-1.343 9-3 9m0-18v9" />
      </svg>
    )},
    { id: 'custom-summaries', label: 'Custom Summaries', icon: (
      <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    )},
  ];

  // Filter functions
  const filterVideoImports = videoImports.filter(record => {
    const matchesSearch = (record.videoid?.toLowerCase().includes(videoImportsSearch.toLowerCase()) ||
                          record.title?.toLowerCase().includes(videoImportsSearch.toLowerCase()) ||
                          record.channel?.toLowerCase().includes(videoImportsSearch.toLowerCase()));
    const matchesStatus = !videoImportsStatusFilter || record.status === videoImportsStatusFilter;
    return matchesSearch && matchesStatus;
  });

  const filterVideoSummaries = videoSummaries.filter(summary => {
    const matchesSearch = (summary.id?.toLowerCase().includes(videoSummariesSearch.toLowerCase()) ||
                          summary.title?.toLowerCase().includes(videoSummariesSearch.toLowerCase()) ||
                          summary.channel?.toLowerCase().includes(videoSummariesSearch.toLowerCase()));
    const matchesStatus = !videoSummariesStatusFilter || summary.status === videoSummariesStatusFilter;
    return matchesSearch && matchesStatus;
  });

  const filterWebsiteSummaries = websiteSummaries.filter(summary => {
    const matchesSearch = (String(summary.id || '').toLowerCase().includes(websiteSummariesSearch.toLowerCase()) ||
                          String(summary.title || '').toLowerCase().includes(websiteSummariesSearch.toLowerCase()) ||
                          String(summary.url || '').toLowerCase().includes(websiteSummariesSearch.toLowerCase()));
    const matchesStatus = !websiteSummariesStatusFilter || summary.status === websiteSummariesStatusFilter;
    return matchesSearch && matchesStatus;
  });

  const filterCustomSummaries = customSummaries.filter(summary => {
    const matchesSearch = (summary.id?.toLowerCase().includes(customSummariesSearch.toLowerCase()) ||
                          summary.title?.toLowerCase().includes(customSummariesSearch.toLowerCase()));
    const matchesStatus = !customSummariesStatusFilter || summary.status === customSummariesStatusFilter;
    return matchesSearch && matchesStatus;
  });

  // Format date helper
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      return date.toLocaleString('nl-NL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return 'Invalid date';
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-dark-bg flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  // Access denied state
  if (accessDenied) {
    return (
      <div className="min-h-screen bg-dark-bg flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="bg-dark-card rounded-lg border border-gray-700 p-8">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-danger rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 0112 21m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-4.03 3-9 3m0 0a9 9 0 019-9m-9 9a9 9 0 019-9m-9 9c1.657 0 3 4.03 3 9s-1.343 9-3 9m0-18v9" />
                </svg>
              </div>
              <h1 className="text-2xl font-bold text-white mb-2">Access Denied</h1>
              <p className="text-text-secondary">
                You are logged in but do not have admin privileges.
              </p>
              <p className="text-sm text-text-secondary mt-2">
                Admin status: {isAdmin ? 'True' : 'False'}<br/>
                Auth mode: {authMode}<br/>
                Username: {user?.username || 'N/A'}
              </p>
            </div>
            <button
              onClick={() => navigate('/')}
              className="w-full btn-primary py-3 font-medium"
            >
              Go to Home Page
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-dark-bg">
      {/* Header */}
      <div className="border-b border-dark-card bg-dark-bg">
        <div className="container mx-auto px-1 py-6">
          <h1 className="text-3xl font-bold text-white mb-2">Admin Dashboard</h1>
          <p className="text-text-secondary">
            Manage application configuration and content
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-1 py-8">
        <div className="flex flex-col md:flex-row gap-6">
          {/* Desktop Sidebar */}
          <div className="hidden md:block md:w-64 flex-shrink-0">
            <nav className="bg-dark-card rounded-lg border border-gray-700 overflow-hidden">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    // Load data when switching tabs
                    if (tab.id === 'video-imports' && videoImports.length === 0) loadVideoImports();
                    if (tab.id === 'video-summaries' && videoSummaries.length === 0) loadVideoSummaries();
                    if (tab.id === 'website-summaries' && websiteSummaries.length === 0) loadWebsiteSummaries();
                    if (tab.id === 'custom-summaries' && customSummaries.length === 0) loadCustomSummaries();
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                    activeTab === tab.id
                      ? 'bg-accent text-white'
                      : 'text-text-secondary hover:text-white hover:bg-dark-card/50'
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </nav>

            <div className="mt-6 p-4 bg-dark-card rounded-lg border border-gray-700">
              <h3 className="font-medium text-white mb-2">System Info</h3>
              <div className="text-sm text-text-secondary space-y-1">
                <p>Auth Method: {authMode}</p>
                <p>Status: Active</p>
                <p>User: {user?.username || 'N/A'}</p>
                <p>Admin: {isAdmin ? 'Yes' : 'No'}</p>
              </div>
            </div>
          </div>

          {/* Mobile Horizontal Navigation */}
          <nav className="md:hidden overflow-x-auto mb-4 -mx-4 px-4">
            <div className="flex gap-2 min-w-max">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    // Load data when switching tabs
                    if (tab.id === 'video-imports' && videoImports.length === 0) loadVideoImports();
                    if (tab.id === 'video-summaries' && videoSummaries.length === 0) loadVideoSummaries();
                    if (tab.id === 'website-summaries' && websiteSummaries.length === 0) loadWebsiteSummaries();
                    if (tab.id === 'custom-summaries' && customSummaries.length === 0) loadCustomSummaries();
                  }}
                  className={`flex items-center gap-2 px-4 py-3 rounded-lg whitespace-nowrap transition-colors ${
                    activeTab === tab.id
                      ? 'bg-accent text-white'
                      : 'bg-dark-card text-text-secondary hover:text-white hover:bg-dark-card/50'
                  }`}
                >
                  {tab.icon}
                  <span className="font-medium">{tab.label}</span>
                </button>
              ))}
            </div>
          </nav>

          {/* Content Area */}
          <div className="flex-1">
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

            {/* Configuration Tab */}
            {activeTab === 'config' && (
              <div className="space-y-6">
                {/* Security Configuration */}
                <CollapsibleSection
                  title="Security Configuration"
                  icon={<svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>}
                  defaultOpen={false}
                >
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-white mb-2">
                        API Rate Limit (requests per 15 minutes)
                      </label>
                      <input
                        type="number"
                        min="100"
                        max="10000"
                        value={config.rateLimitMax}
                        onChange={(e) => setConfig({ ...config, rateLimitMax: parseInt(e.target.value) || 1000 })}
                        className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                      />
                      <p className="text-xs text-text-secondary mt-1">
                        Maximum API requests allowed per IP address per 15 minutes. Default: 1000. Range: 100-10000.
                      </p>
                    </div>
                  </div>
                </CollapsibleSection>

                {/* YouTube Worker Configuration */}
                <CollapsibleSection
                  title="YouTube Worker Configuration"
                  icon={<svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>}
                  defaultOpen={false}
                >
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-white mb-2">
                          Import Checker Interval (Minutes)
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={config.importCheckerIntervalMinutes}
                          onChange={(e) => setConfig({...config, importCheckerIntervalMinutes: parseInt(e.target.value)})}
                          className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                        />
                        <p className="text-xs text-text-secondary mt-1">
                          How often YtDlpWorker checks for new videos to process.
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white mb-2">
                          Cookies.txt File (Optional)
                        </label>
                        <p className="text-xs text-text-secondary mb-2">
                          Upload cookies.txt for age-restricted videos. Export from browser with "Get cookies.txt" extension.
                        </p>
                        <input
                          type="file"
                          accept=".txt"
                          onChange={handleCookiesUpload}
                          className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                        />
                        {cookiesUploaded && (
                          <p className="text-xs text-green-500 mt-1">✓ Cookies file uploaded successfully</p>
                        )}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white mb-2">
                          YtDlp Item Delay (Seconds)
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={config.ytDlpItemDelaySeconds}
                          onChange={(e) => setConfig({...config, ytDlpItemDelaySeconds: parseInt(e.target.value) || 0})}
                          className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                        />
                        <p className="text-xs text-text-secondary mt-1">
                          Delay between YouTube video transcript requests
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white mb-2">
                          Provider Timeout (Minutes)
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="120"
                          value={config.pythonProviderTimeoutMinutes}
                          onChange={(e) => setConfig({...config, pythonProviderTimeoutMinutes: parseInt(e.target.value) || 45})}
                          className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                        />
                        <p className="text-xs text-text-secondary mt-1">
                          Timeout for Python provider script (covers proxy retries)
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white mb-2">
                          Failed Job Retry Interval (Hours)
                        </label>
                        <input
                          type="number"
                          min="0"
                          max="168"
                          value={config.ytDlpFailedJobRetryHours}
                          onChange={(e) => setConfig({...config, ytDlpFailedJobRetryHours: parseInt(e.target.value) || 0})}
                          className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                        />
                        <p className="text-xs text-text-secondary mt-1">
                          Hours to wait before automatically retrying failed jobs (0 = disabled, max 168/7 days)
                        </p>
                      </div>
                    </div>
                  </div>
                </CollapsibleSection>

                {/* Proxy Rotation Configuration */}
                <CollapsibleSection
                  title="Proxy Rotation Configuration"
                  icon={<svg className="w-6 h-6 text-cyan-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064" />
                  </svg>}
                  defaultOpen={false}
                >
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-dark-bg rounded-lg">
                      <div>
                        <h3 className="font-medium text-white">Enable Proxy Rotation</h3>
                        <p className="text-sm text-text-secondary">Master switch to enable proxy rotation for YouTube</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={config.ytDlpProxyEnabled}
                          onChange={(e) => setConfig({...config, ytDlpProxyEnabled: e.target.checked})}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-accent/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent"></div>
                      </label>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-white mb-2">
                          Proxy Type
                        </label>
                        <select
                          value={config.ytDlpProxyType}
                          onChange={(e) => setConfig({...config, ytDlpProxyType: e.target.value})}
                          className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                        >
                          <option value="free">Free (ProxyScrape)</option>
                          <option value="paid">Paid (Custom)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white mb-2">
                          Minimum Pool Size
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={config.ytDlpProxyMinPoolSize}
                          onChange={(e) => setConfig({...config, ytDlpProxyMinPoolSize: parseInt(e.target.value) || 1})}
                          className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white mb-2">
                          Target Pool Size
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={config.ytDlpProxyPoolSize}
                          onChange={(e) => setConfig({...config, ytDlpProxyPoolSize: parseInt(e.target.value) || 1})}
                          className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white mb-2">
                          Max Test Attempts
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={config.ytDlpProxyMaxTestAttempts}
                          onChange={(e) => setConfig({...config, ytDlpProxyMaxTestAttempts: parseInt(e.target.value) || 1})}
                          className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white mb-2">
                          Max Retries
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={config.ytDlpProxyMaxRetries}
                          onChange={(e) => setConfig({...config, ytDlpProxyMaxRetries: parseInt(e.target.value) || 0})}
                          className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white mb-2">
                          Min Backoff (Seconds)
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={config.ytDlpProxyMinBackoff}
                          onChange={(e) => setConfig({...config, ytDlpProxyMinBackoff: parseInt(e.target.value) || 0})}
                          className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white mb-2">
                          Max Backoff (Seconds)
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={config.ytDlpProxyMaxBackoff}
                          onChange={(e) => setConfig({...config, ytDlpProxyMaxBackoff: parseInt(e.target.value) || 0})}
                          className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white mb-2">
                          Max Response Time (Seconds)
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={config.ytDlpProxyMaxResponseTime}
                          onChange={(e) => setConfig({...config, ytDlpProxyMaxResponseTime: parseInt(e.target.value) || 1})}
                          className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-white mb-2">
                          Paid Proxy API Key
                        </label>
                        <input
                          type="password"
                          value={config.ytDlpProxyPaidApiKey}
                          onChange={(e) => setConfig({...config, ytDlpProxyPaidApiKey: e.target.value})}
                          className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                          placeholder="Enter API key for paid proxy service"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white mb-2">
                          Paid Proxy Endpoint
                        </label>
                        <input
                          type="text"
                          value={config.ytDlpProxyPaidEndpoint}
                          onChange={(e) => setConfig({...config, ytDlpProxyPaidEndpoint: e.target.value})}
                          className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                          placeholder="https://api.proxy-service.com"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white mb-2">
                        Blocked Ports (comma-separated)
                      </label>
                      <input
                        type="text"
                        value={config.ytDlpProxyBlockedPorts}
                        onChange={(e) => setConfig({...config, ytDlpProxyBlockedPorts: e.target.value})}
                        className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                        placeholder="3128,3129,8080,8888"
                      />
                    </div>
                    <div className="flex items-center justify-between p-4 bg-dark-bg rounded-lg">
                      <div>
                        <h3 className="font-medium text-white">Test YouTube Directly</h3>
                        <p className="text-sm text-text-secondary">Test proxies against YouTube (robots.txt) instead of generic endpoint</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={config.ytDlpProxyTestYoutubeDirectly}
                          onChange={(e) => setConfig({...config, ytDlpProxyTestYoutubeDirectly: e.target.checked})}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-accent/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent"></div>
                      </label>
                    </div>
                    <div className="flex items-center justify-between p-4 bg-dark-bg rounded-lg">
                      <div>
                        <h3 className="font-medium text-white">Enable HTTPS Fallback</h3>
                        <p className="text-sm text-text-secondary">Test HTTPS tunneling when robots.txt fails (catches 502/503 errors)</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={config.ytDlpProxyEnableHttpsFallback}
                          onChange={(e) => setConfig({...config, ytDlpProxyEnableHttpsFallback: e.target.checked})}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-accent/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent"></div>
                      </label>
                    </div>
                  </div>
                </CollapsibleSection>

                {/* AI Prompts */}
                <CollapsibleSection
                  title="AI Prompts"
                  icon={<svg className="w-6 h-6 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>}
                  defaultOpen={false}
                >
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-white mb-2">
                        Video Summary AI Prompt
                      </label>
                      <textarea
                        rows="6"
                        value={config.summarySystemPrompt}
                        onChange={(e) => setConfig({...config, summarySystemPrompt: e.target.value})}
                        className="w-full px-4 py-3 bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field font-mono text-sm"
                        placeholder="Enter your system prompt for video summaries..."
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white mb-2">
                        Website Summary AI Prompt
                      </label>
                      <textarea
                        rows="6"
                        value={config.websiteSummarySystemPrompt}
                        onChange={(e) => setConfig({...config, websiteSummarySystemPrompt: e.target.value})}
                        className="w-full px-4 py-3 bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field font-mono text-sm"
                        placeholder="Enter your system prompt for website summaries..."
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white mb-2">
                        Custom Summary AI Prompt
                      </label>
                      <textarea
                        rows="6"
                        value={config.customSummarySystemPrompt}
                        onChange={(e) => setConfig({...config, customSummarySystemPrompt: e.target.value})}
                        className="w-full px-4 py-3 bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field font-mono text-sm"
                        placeholder="Enter your system prompt for custom summaries..."
                      />
                    </div>
                  </div>
                </CollapsibleSection>

                {/* Chunking Configuration */}
                <CollapsibleSection
                  title="Content Chunking Configuration"
                  icon={<svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                  </svg>}
                  defaultOpen={false}
                >
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-dark-bg rounded-lg">
                      <div>
                        <h3 className="font-medium text-white">Enable Content Chunking</h3>
                        <p className="text-sm text-text-secondary">Automatically break large content into smaller pieces</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={config.enableChunking}
                          onChange={(e) => setConfig({...config, enableChunking: e.target.checked})}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-accent/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent"></div>
                      </label>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white mb-2">
                        Max Context Window (Tokens)
                      </label>
                      <input
                        type="number"
                        min="1000"
                        max="128000"
                        value={config.maxContextWindow}
                        onChange={(e) => setConfig({...config, maxContextWindow: parseInt(e.target.value)})}
                        className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white mb-2">
                        Chunk Overlap Size (Characters)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="10000"
                        value={config.chunkOverlapSize}
                        onChange={(e) => setConfig({...config, chunkOverlapSize: parseInt(e.target.value)})}
                        className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white mb-2">
                        Chunking Strategy
                      </label>
                      <select
                        value={config.chunkingStrategy}
                        onChange={(e) => setConfig({...config, chunkingStrategy: e.target.value})}
                        className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                      >
                        <option value="simple">Simple (Character-based)</option>
                        <option value="semantic">Semantic (Paragraph-based)</option>
                      </select>
                    </div>
                  </div>
                </CollapsibleSection>

                {/* MyCloud Chat Configuration */}
                <CollapsibleSection
                  title="MyCloud Chat Configuration"
                  icon={<svg className="w-6 h-6 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>}
                  defaultOpen={false}
                >
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-white mb-2">
                        OpenAI API URL
                      </label>
                      <input
                        type="text"
                        value={config.chatOpenaiApiUrl}
                        onChange={(e) => setConfig({...config, chatOpenaiApiUrl: e.target.value})}
                        className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white mb-2">
                        OpenAI Model
                      </label>
                      <input
                        type="text"
                        value={config.chatOpenaiModel}
                        onChange={(e) => setConfig({...config, chatOpenaiModel: e.target.value})}
                        className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white mb-2">
                        OpenAI System Prompt
                      </label>
                      <textarea
                        rows="5"
                        value={config.chatOpenaiSystemPrompt}
                        onChange={(e) => setConfig({...config, chatOpenaiSystemPrompt: e.target.value})}
                        className="w-full px-4 py-3 bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field font-mono text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white mb-2">
                        OpenAI API Key (Optional)
                      </label>
                      <input
                        type="password"
                        value={config.chatOpenaiApiKey}
                        onChange={(e) => setConfig({...config, chatOpenaiApiKey: e.target.value})}
                        className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                        placeholder="Leave empty to use environment variable"
                      />
                    </div>
                  </div>
                </CollapsibleSection>

                {/* PublicAI Configuration */}
                <CollapsibleSection
                  title="PublicAI Configuration"
                  icon={<svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>}
                  defaultOpen={false}
                >
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-white mb-2">
                        PublicAI API URL
                      </label>
                      <input
                        type="text"
                        value={config.chatPublicaiApiUrl || ''}
                        onChange={(e) => setConfig({...config, chatPublicaiApiUrl: e.target.value})}
                        className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                        placeholder="https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
                      />
                      <p className="mt-1 text-xs text-text-secondary">
                        Full OpenAI-compatible endpoint URL (Gemini: /v1beta/openai/chat/completions)
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white mb-2">
                        PublicAI Model
                      </label>
                      <input
                        type="text"
                        value={config.chatPublicaiModel || ''}
                        onChange={(e) => setConfig({...config, chatPublicaiModel: e.target.value})}
                        className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                        placeholder="gemini-2.0-flash-exp"
                      />
                      <p className="mt-1 text-xs text-text-secondary">
                        Gemini: gemini-2.0-flash-exp, gemini-2.0-flash, gemini-1.5-pro
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white mb-2">
                        PublicAI System Prompt
                      </label>
                      <textarea
                        rows="5"
                        value={config.chatPublicaiSystemPrompt || ''}
                        onChange={(e) => setConfig({...config, chatPublicaiSystemPrompt: e.target.value})}
                        className="w-full px-4 py-3 bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field font-mono text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white mb-2">
                        PublicAI API Key (Optional)
                      </label>
                      <input
                        type="password"
                        value={config.chatPublicaiApiKey || ''}
                        onChange={(e) => setConfig({...config, chatPublicaiApiKey: e.target.value})}
                        className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                        placeholder="Leave empty if not required"
                      />
                    </div>
                  </div>
                </CollapsibleSection>

                {/* Summarizing AI Configuration */}
                <CollapsibleSection
                  title="Summarizing AI Configuration"
                  icon={<svg className="w-6 h-6 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>}
                  defaultOpen={false}
                >
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-white mb-2">
                        OpenAI API URL
                      </label>
                      <input
                        type="text"
                        value={config.summaryOpenaiApiUrl}
                        onChange={(e) => setConfig({...config, summaryOpenaiApiUrl: e.target.value})}
                        className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white mb-2">
                        OpenAI Model
                      </label>
                      <input
                        type="text"
                        value={config.summaryOpenaiModel}
                        onChange={(e) => setConfig({...config, summaryOpenaiModel: e.target.value})}
                        className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white mb-2">
                        OpenAI API Key (Optional)
                      </label>
                      <input
                        type="password"
                        value={config.summaryOpenaiApiKey}
                        onChange={(e) => setConfig({...config, summaryOpenaiApiKey: e.target.value})}
                        className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                        placeholder="Leave empty to use environment variable"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white mb-2">
                        OpenAI API Timeout (Minutes)
                      </label>
                      <input
                        type="number"
                        min="3"
                        max="60"
                        value={config.openaiTimeoutMinutes}
                        onChange={(e) => setConfig({...config, openaiTimeoutMinutes: parseInt(e.target.value)})}
                        className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-white mb-2">
                          Summary Process Interval (Minutes)
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={config.summaryProcessorIntervalMinutes}
                          onChange={(e) => setConfig({...config, summaryProcessorIntervalMinutes: parseInt(e.target.value)})}
                          className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white mb-2">
                          Delay Between Items (Seconds)
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={config.summaryProcessorItemDelaySeconds}
                          onChange={(e) => setConfig({...config, summaryProcessorItemDelaySeconds: parseInt(e.target.value)})}
                          className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white mb-2">
                          Initial Processing Delay (Seconds)
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={config.summaryProcessorDelaySeconds}
                          onChange={(e) => setConfig({...config, summaryProcessorDelaySeconds: parseInt(e.target.value)})}
                          className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white mb-2">
                          Retry Delay on Failure (Seconds)
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={config.summaryRetryDelaySeconds}
                          onChange={(e) => setConfig({...config, summaryRetryDelaySeconds: parseInt(e.target.value)})}
                          className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Failover Configuration - New Section */}
                  <div className="mt-6 pt-6 border-t border-gray-700">
                    <h4 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                      <svg className="w-5 h-5 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Endpoint Failover Configuration
                    </h4>

                    <div className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-white mb-2">
                            Failover Mode
                          </label>
                          <select
                            value={config.summaryOpenaiFailoverMode}
                            onChange={(e) => setConfig({...config, summaryOpenaiFailoverMode: e.target.value})}
                            className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                          >
                            <option value="failover">Failover (Primary → Secondary)</option>
                            <option value="secondary_to_primary">Failover (Secondary → Primary)</option>
                            <option value="primary_only">Primary Only</option>
                            <option value="secondary_only">Secondary Only</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-white mb-2">
                            Failover Timeout (Seconds)
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="300"
                            value={config.summaryOpenaiFailoverTimeoutSeconds}
                            onChange={(e) => setConfig({...config, summaryOpenaiFailoverTimeoutSeconds: parseInt(e.target.value) || 60})}
                            className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                          />
                          <p className="text-xs text-text-secondary mt-1">Time to wait before failing over (1-300 seconds)</p>
                        </div>
                      </div>

                      {/* Active Endpoint Display */}
                      <div className="mt-4 p-4 bg-dark-bg/50 rounded-lg border border-gray-700">
                        <h5 className="text-sm font-semibold text-white mb-3">Active Endpoint Configuration</h5>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="text-text-secondary">Primary URL:</span>
                            <p className="text-white break-all font-mono text-xs mt-1">
                              {config.summaryOpenaiApiUrl || 'Not configured'}
                            </p>
                          </div>
                          <div>
                            <span className="text-text-secondary">Secondary URL:</span>
                            <p className="text-white break-all font-mono text-xs mt-1">
                              {config.summaryOpenaiSecondaryApiUrl || 'Not configured'}
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 pt-3 border-t border-gray-700">
                          <span className="text-text-secondary">Active Mode:</span>
                          <span className="ml-2 px-2 py-1 rounded bg-accent/20 text-accent text-xs">
                            {config.summaryOpenaiFailoverMode === 'failover' && 'Primary → Secondary'}
                            {config.summaryOpenaiFailoverMode === 'secondary_to_primary' && 'Secondary → Primary'}
                            {config.summaryOpenaiFailoverMode === 'primary_only' && 'Primary Only'}
                            {config.summaryOpenaiFailoverMode === 'secondary_only' && 'Secondary Only'}
                          </span>
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-white mb-2">
                          Secondary API URL
                        </label>
                        <input
                          type="text"
                          value={config.summaryOpenaiSecondaryApiUrl}
                          onChange={(e) => setConfig({...config, summaryOpenaiSecondaryApiUrl: e.target.value})}
                          className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                          placeholder="https://api.openai.com/v1/chat/completions"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-white mb-2">
                          Secondary Model
                        </label>
                        <input
                          type="text"
                          value={config.summaryOpenaiSecondaryModel}
                          onChange={(e) => setConfig({...config, summaryOpenaiSecondaryModel: e.target.value})}
                          className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                          placeholder="Required when using secondary endpoint"
                        />
                        <p className="text-xs text-text-secondary mt-1">Required when failover mode is not 'primary_only'</p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-white mb-2">
                          Secondary API Key (Optional)
                        </label>
                        <input
                          type="password"
                          value={config.summaryOpenaiSecondaryApiKey}
                          onChange={(e) => setConfig({...config, summaryOpenaiSecondaryApiKey: e.target.value})}
                          className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                          placeholder="Uses primary API key if empty"
                        />
                        <p className="text-xs text-text-secondary mt-1">Leave empty to use the primary API key</p>
                      </div>
                    </div>
                  </div>
                </CollapsibleSection>

                {/* OnDevice Chat Configuration */}
                <CollapsibleSection
                  title="OnDevice Chat Configuration"
                  icon={<svg className="w-6 h-6 text-pink-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>}
                  defaultOpen={false}
                >
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-dark-bg rounded-lg">
                      <div>
                        <h3 className="font-medium text-white">Enable WebLLM</h3>
                        <p className="text-sm text-text-secondary">Enable local LLM inference using WebGPU</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={config.webllmEnabled}
                          onChange={(e) => setConfig({...config, webllmEnabled: e.target.checked})}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-accent/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent"></div>
                      </label>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white mb-2">
                        HuggingFace Model URL
                      </label>
                      <input
                        type="text"
                        value={config.webllmHfModelUrl}
                        onChange={(e) => setConfig({...config, webllmHfModelUrl: e.target.value})}
                        className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                        placeholder="HF://org/model-name"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white mb-2">
                        Default Chat Mode
                      </label>
                      <select
                        value={config.webllmDefaultMode}
                        onChange={(e) => setConfig({...config, webllmDefaultMode: e.target.value})}
                        className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                      >
                        <option value="cloud">Cloud (OpenAI)</option>
                        <option value="local">Local (WebGPU)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white mb-2">
                        WebLLM System Prompt
                      </label>
                      <textarea
                        rows="5"
                        value={config.webllmSystemPrompt}
                        onChange={(e) => setConfig({...config, webllmSystemPrompt: e.target.value})}
                        className="w-full px-4 py-3 bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field font-mono text-sm"
                        placeholder="Enter your system prompt for WebLLM local inference..."
                      />
                    </div>
                  </div>
                </CollapsibleSection>

                {/* Chat Enhancement Configuration */}
                <CollapsibleSection
                  title="Chat Enhancement Configuration"
                  icon={<svg className="w-6 h-6 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>}
                  defaultOpen={false}
                >
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-dark-bg rounded-lg">
                      <div>
                        <h3 className="font-medium text-white">Stream with Reasoning</h3>
                        <p className="text-sm text-text-secondary">Enable streaming responses with reasoning extraction</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={config.chatStreamWithReasoning}
                          onChange={(e) => setConfig({...config, chatStreamWithReasoning: e.target.checked})}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-accent/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent"></div>
                      </label>
                    </div>
                    <div className="flex items-center justify-between p-4 bg-dark-bg rounded-lg">
                      <div>
                        <h3 className="font-medium text-white">Include Token Metrics</h3>
                        <p className="text-sm text-text-secondary">Include token usage metrics in chat responses</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={config.chatIncludeMetrics}
                          onChange={(e) => setConfig({...config, chatIncludeMetrics: e.target.checked})}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-accent/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent"></div>
                      </label>
                    </div>
                    <div className="flex items-center justify-between p-4 bg-dark-bg rounded-lg">
                      <div>
                        <h3 className="font-medium text-white">Debug Reasoning</h3>
                        <p className="text-sm text-text-secondary">Enable debug logging for reasoning parsing</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={config.chatDebugReasoning}
                          onChange={(e) => setConfig({...config, chatDebugReasoning: e.target.checked})}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-accent/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent"></div>
                      </label>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-white mb-2">
                        Reasoning Format
                      </label>
                      <select
                        value={config.chatReasoningFormat}
                        onChange={(e) => setConfig({...config, chatReasoningFormat: e.target.value})}
                        className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                      >
                        <option value="deepseek">DeepSeek</option>
                        <option value="deepseek-legacy">DeepSeek Legacy</option>
                        <option value="none">None</option>
                      </select>
                      <p className="text-xs text-text-secondary mt-1">
                        Format for reasoning extraction from AI responses
                      </p>
                    </div>
                  </div>
                </CollapsibleSection>

                {/* Playlist Worker Configuration */}
                <CollapsibleSection
                  title="Playlist Worker Configuration"
                  icon={<svg className="w-6 h-6 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                  </svg>}
                  defaultOpen={false}
                >
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-white mb-2">
                          Playlist Checker Interval (Minutes)
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={config.playlistCheckerIntervalMinutes}
                          onChange={(e) => setConfig({...config, playlistCheckerIntervalMinutes: parseInt(e.target.value) || 1})}
                          className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                        />
                        <p className="text-xs text-text-secondary mt-1">
                          How often the playlist sync worker checks for new videos
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-white mb-2">
                          Max New Videos Per Sync
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={config.playlistMaxNewVideosPerSync}
                          onChange={(e) => setConfig({...config, playlistMaxNewVideosPerSync: parseInt(e.target.value) || 1})}
                          className="w-full px-4 py-3 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                        />
                        <p className="text-xs text-text-secondary mt-1">
                          Maximum new videos to import per sync cycle
                        </p>
                      </div>
                    </div>
                  </div>
                </CollapsibleSection>

                {/* Save Button */}
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => navigate('/')}
                    className="px-6 py-3 btn-secondary font-medium"
                  >
                    Back to Home
                  </button>
                  <button
                    onClick={handleSaveConfig}
                    disabled={saving}
                    className="px-6 py-3 btn-primary font-medium flex items-center gap-2"
                  >
                    {saving ? (
                      <>
                        <LoadingSpinner size="sm" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Save Configuration
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Video Imports Tab */}
            {activeTab === 'video-imports' && (
              <div className="space-y-6">
                <div className="bg-dark-card rounded-lg border border-gray-700 p-6">
                  <div className="flex flex-col md:flex-row md:justify-between md:items-center mb-6 gap-4">
                    <h2 className="text-xl font-bold text-white">Video Imports</h2>
                    <button
                      onClick={loadVideoImports}
                      disabled={loadingVideoImports}
                      className="px-4 py-2 btn-secondary flex items-center gap-2 self-start"
                    >
                      {loadingVideoImports ? (
                        <><LoadingSpinner size="sm" /></>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      )}
                      Refresh
                    </button>
                  </div>

                  {/* Search and Filter */}
                  <div className="flex flex-col md:flex-row gap-4 mb-6">
                    <input
                      type="text"
                      placeholder="Search video imports..."
                      value={videoImportsSearch}
                      onChange={(e) => setVideoImportsSearch(e.target.value)}
                      className="flex-1 px-4 py-2 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                    />
                    <select
                      value={videoImportsStatusFilter}
                      onChange={(e) => setVideoImportsStatusFilter(e.target.value)}
                      className="px-4 py-2 min-h-[44px] md:w-auto bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                    >
                      <option value="">All Statuses</option>
                      <option value="NEW_YTDLP">NEW_YTDLP (Waiting for YtDlp)</option>
                      <option value="PENDING_YTDLP">PENDING_YTDLP (Processing)</option>
                      <option value="NEW">NEW (Ready for Summary)</option>
                      <option value="PENDING">PENDING (Summarizing)</option>
                      <option value="DONE">DONE</option>
                      <option value="FAILED">FAILED</option>
                    </select>
                  </div>

                  {/* Table */}
                  {loadingVideoImports ? (
                    <div className="flex justify-center py-8">
                      <LoadingSpinner size="lg" />
                    </div>
                  ) : filterVideoImports.length === 0 ? (
                    <div className="text-center py-8 text-text-secondary">
                      No video imports found
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-gray-700">
                            <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">Video ID</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">Title</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">Channel</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">Status</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">Date Import</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">Status Actions</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filterVideoImports.map((record) => (
                            <tr key={record.videoid} className="border-b border-gray-700 hover:bg-dark-card/50">
                              <td className="px-4 py-3 text-sm text-white break-all">{record.videoid}</td>
                              <td className="px-4 py-3 text-sm text-white">{record.title || 'Untitled'}</td>
                              <td className="px-4 py-3 text-sm text-white">{record.channel || 'N/A'}</td>
                              <td className="px-4 py-3 text-sm">
                                <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                                  record.status === 'DONE' ? 'bg-success/20 text-success' :
                                  record.status === 'FAILED' ? 'bg-danger/20 text-danger' :
                                  'bg-accent/20 text-accent'
                                }`}>
                                  {record.status}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-sm text-white">{formatDate(record.date_import)}</td>
                              <td className="px-4 py-3 text-sm">
                                <select
                                  value={record.status}
                                  onChange={(e) => handleVideoImportStatusChange(record.videoid, e.target.value)}
                                  className="px-2 py-2 min-h-[44px] bg-dark-bg text-white rounded border border-gray-700 focus:border-accent text-sm"
                                >
                                  <option value="NEW_YTDLP" selected={record.status === 'NEW_YTDLP'}>NEW_YTDLP</option>
                                  <option value="PENDING_YTDLP" selected={record.status === 'PENDING_YTDLP'}>PENDING_YTDLP</option>
                                  <option value="NEW" selected={record.status === 'NEW'}>NEW</option>
                                  <option value="PENDING" selected={record.status === 'PENDING'}>PENDING</option>
                                  <option value="DONE" selected={record.status === 'DONE'}>DONE</option>
                                  <option value="FAILED" selected={record.status === 'FAILED'}>FAILED</option>
                                </select>
                              </td>
                              <td className="px-4 py-3 text-sm">
                                <button
                                  onClick={() => handleDeleteVideoImport(record.videoid)}
                                  className="px-3 py-2 min-h-[44px] bg-danger text-white rounded text-sm hover:bg-danger/80 transition-colors"
                                >
                                  Delete
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Video Summaries Tab */}
            {activeTab === 'video-summaries' && (
              <div className="space-y-6">
                <div className="bg-dark-card rounded-lg border border-gray-700 p-6">
                  <div className="flex flex-col md:flex-row md:justify-between md:items-center mb-6 gap-4">
                    <h2 className="text-xl font-bold text-white">Video Summaries</h2>
                    <button
                      onClick={loadVideoSummaries}
                      disabled={loadingVideoSummaries}
                      className="px-4 py-2 btn-secondary flex items-center gap-2 self-start"
                    >
                      {loadingVideoSummaries ? (
                        <><LoadingSpinner size="sm" /></>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      )}
                      Refresh
                    </button>
                  </div>

                  {/* Search and Filter */}
                  <div className="flex flex-col md:flex-row gap-4 mb-6">
                    <input
                      type="text"
                      placeholder="Search video summaries..."
                      value={videoSummariesSearch}
                      onChange={(e) => setVideoSummariesSearch(e.target.value)}
                      className="flex-1 px-4 py-2 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                    />
                    <select
                      value={videoSummariesStatusFilter}
                      onChange={(e) => setVideoSummariesStatusFilter(e.target.value)}
                      className="px-4 py-2 min-h-[44px] md:w-auto bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                    >
                      <option value="">All Statuses</option>
                      <option value="NEW">NEW</option>
                      <option value="PENDING">PENDING</option>
                      <option value="DONE">DONE</option>
                      <option value="FAILED">FAILED</option>
                    </select>
                  </div>

                  {/* Table */}
                  {loadingVideoSummaries ? (
                    <div className="flex justify-center py-8">
                      <LoadingSpinner size="lg" />
                    </div>
                  ) : filterVideoSummaries.length === 0 ? (
                    <div className="text-center py-8 text-text-secondary">
                      No video summaries found
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-gray-700">
                            <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">ID</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">Title</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">Channel</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">Status</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">Date Created</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filterVideoSummaries.map((summary) => (
                            <tr key={summary.id} className="border-b border-gray-700 hover:bg-dark-card/50">
                              <td className="px-4 py-3 text-sm text-white break-all">{summary.id}</td>
                              <td className="px-4 py-3 text-sm text-white">{summary.title || 'Untitled'}</td>
                              <td className="px-4 py-3 text-sm text-white">{summary.channel || 'N/A'}</td>
                              <td className="px-4 py-3 text-sm">
                                <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                                  summary.status === 'DONE' ? 'bg-success/20 text-success' :
                                  summary.status === 'FAILED' ? 'bg-danger/20 text-danger' :
                                  'bg-accent/20 text-accent'
                                }`}>
                                  {summary.status}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-sm text-white">{formatDate(summary.date_created)}</td>
                              <td className="px-4 py-3 text-sm">
                                <button
                                  onClick={() => handleDeleteVideoSummary(summary.id)}
                                  className="px-3 py-2 min-h-[44px] bg-danger text-white rounded text-sm hover:bg-danger/80 transition-colors"
                                >
                                  Delete
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Website Summaries Tab */}
            {activeTab === 'website-summaries' && (
              <div className="space-y-6">
                <div className="bg-dark-card rounded-lg border border-gray-700 p-6">
                  <div className="flex flex-col md:flex-row md:justify-between md:items-center mb-6 gap-4">
                    <h2 className="text-xl font-bold text-white">Website Summaries</h2>
                    <button
                      onClick={loadWebsiteSummaries}
                      disabled={loadingWebsiteSummaries}
                      className="px-4 py-2 btn-secondary flex items-center gap-2 self-start"
                    >
                      {loadingWebsiteSummaries ? (
                        <><LoadingSpinner size="sm" /></>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      )}
                      Refresh
                    </button>
                  </div>

                  {/* Search and Filter */}
                  <div className="flex flex-col md:flex-row gap-4 mb-6">
                    <input
                      type="text"
                      placeholder="Search website summaries..."
                      value={websiteSummariesSearch}
                      onChange={(e) => setWebsiteSummariesSearch(e.target.value)}
                      className="flex-1 px-4 py-2 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                    />
                    <select
                      value={websiteSummariesStatusFilter}
                      onChange={(e) => setWebsiteSummariesStatusFilter(e.target.value)}
                      className="px-4 py-2 min-h-[44px] md:w-auto bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                    >
                      <option value="">All Statuses</option>
                      <option value="NEW">NEW</option>
                      <option value="PENDING">PENDING</option>
                      <option value="DONE">DONE</option>
                      <option value="FAILED">FAILED</option>
                    </select>
                  </div>

                  {/* Table */}
                  {loadingWebsiteSummaries ? (
                    <div className="flex justify-center py-8">
                      <LoadingSpinner size="lg" />
                    </div>
                  ) : filterWebsiteSummaries.length === 0 ? (
                    <div className="text-center py-8 text-text-secondary">
                      No website summaries found
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-gray-700">
                            <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">ID</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">Title</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">URL</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">Status</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">Date Created</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filterWebsiteSummaries.map((summary) => (
                            <tr key={summary.id} className="border-b border-gray-700 hover:bg-dark-card/50">
                              <td className="px-4 py-3 text-sm text-white">{String(summary.id || '').substring(0, 8)}</td>
                              <td className="px-4 py-3 text-sm text-white">{summary.title || 'Untitled'}</td>
                              <td className="px-4 py-3 text-sm text-white">
                                <a
                                  href={summary.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-accent hover:text-accent/80 underline"
                                >
                                  {summary.url ? String(summary.url).substring(0, 30) + (String(summary.url).length > 30 ? '...' : '') : 'N/A'}
                                </a>
                              </td>
                              <td className="px-4 py-3 text-sm">
                                <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                                  summary.status === 'DONE' ? 'bg-success/20 text-success' :
                                  summary.status === 'FAILED' ? 'bg-danger/20 text-danger' :
                                  'bg-accent/20 text-accent'
                                }`}>
                                  {summary.status}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-sm text-white">{formatDate(summary.date_created)}</td>
                              <td className="px-4 py-3 text-sm">
                                <button
                                  onClick={() => handleDeleteWebsiteSummary(summary.id)}
                                  className="px-3 py-2 min-h-[44px] bg-danger text-white rounded text-sm hover:bg-danger/80 transition-colors"
                                >
                                  Delete
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Custom Summaries Tab */}
            {activeTab === 'custom-summaries' && (
              <div className="space-y-6">
                <div className="bg-dark-card rounded-lg border border-gray-700 p-6">
                  <div className="flex flex-col md:flex-row md:justify-between md:items-center mb-6 gap-4">
                    <h2 className="text-xl font-bold text-white">Custom Summaries</h2>
                    <button
                      onClick={loadCustomSummaries}
                      disabled={loadingCustomSummaries}
                      className="px-4 py-2 btn-secondary flex items-center gap-2 self-start"
                    >
                      {loadingCustomSummaries ? (
                        <><LoadingSpinner size="sm" /></>
                      ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      )}
                      Refresh
                    </button>
                  </div>

                  {/* Search and Filter */}
                  <div className="flex flex-col md:flex-row gap-4 mb-6">
                    <input
                      type="text"
                      placeholder="Search custom summaries..."
                      value={customSummariesSearch}
                      onChange={(e) => setCustomSummariesSearch(e.target.value)}
                      className="flex-1 px-4 py-2 min-h-[44px] bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                    />
                    <select
                      value={customSummariesStatusFilter}
                      onChange={(e) => setCustomSummariesStatusFilter(e.target.value)}
                      className="px-4 py-2 min-h-[44px] md:w-auto bg-dark-bg text-white rounded-lg border border-gray-700 focus:border-accent focus:ring-2 focus:ring-accent/20 input-field"
                    >
                      <option value="">All Statuses</option>
                      <option value="NEW">NEW</option>
                      <option value="PENDING">PENDING</option>
                      <option value="DONE">DONE</option>
                      <option value="FAILED">FAILED</option>
                    </select>
                  </div>

                  {/* Table */}
                  {loadingCustomSummaries ? (
                    <div className="flex justify-center py-8">
                      <LoadingSpinner size="lg" />
                    </div>
                  ) : filterCustomSummaries.length === 0 ? (
                    <div className="text-center py-8 text-text-secondary">
                      No custom summaries found
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-gray-700">
                            <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">ID</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">Title</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">Status</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">Date Created</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-text-secondary">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filterCustomSummaries.map((summary) => (
                            <tr key={summary.id} className="border-b border-gray-700 hover:bg-dark-card/50">
                              <td className="px-4 py-3 text-sm text-white">{String(summary.id || '').substring(0, 8)}</td>
                              <td className="px-4 py-3 text-sm text-white">{summary.title || 'Untitled'}</td>
                              <td className="px-4 py-3 text-sm">
                                <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                                  summary.status === 'DONE' ? 'bg-success/20 text-success' :
                                  summary.status === 'FAILED' ? 'bg-danger/20 text-danger' :
                                  'bg-accent/20 text-accent'
                                }`}>
                                  {summary.status}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-sm text-white">{formatDate(summary.date_created)}</td>
                              <td className="px-4 py-3 text-sm">
                                <button
                                  onClick={() => handleDeleteCustomSummary(summary.id)}
                                  className="px-3 py-2 min-h-[44px] bg-danger text-white rounded text-sm hover:bg-danger/80 transition-colors"
                                >
                                  Delete
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Mobile System Info Section */}
        <div className="md:hidden mt-6 p-4 bg-dark-card rounded-lg border border-gray-700">
          <h3 className="font-medium text-white mb-2">System Info</h3>
          <div className="text-sm text-text-secondary space-y-1">
            <p>Auth Method: {authMode}</p>
            <p>Status: Active</p>
            <p>User: {user?.username || 'N/A'}</p>
            <p>Admin: {isAdmin ? 'Yes' : 'No'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AdminPage;
import { useState, useCallback, useRef, useEffect } from 'react';
import { sendArenaChatMessage } from '../utils/api';
import { CreateMLCEngine } from '@mlc-ai/web-llm';

const CHAT_SELECTION_STORAGE_KEY = 'chatArenaInitialSummaries';

/**
 * Custom hook for chat arena functionality
 * @returns {object} - Chat state and methods
 */
export function useChat() {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedSummaries, setSelectedSummaries] = useState({});
  const [allSummaries, setAllSummaries] = useState([]);
  const [mode, setMode] = useState('publicai'); // 'publicai', 'cloud', or 'webgpu'
  const [modelLoadingProgress, setModelLoadingProgress] = useState(0);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [sidebarMode, setSidebarMode] = useState('summaries'); // 'summaries' or 'tags'
  const [selectedTags, setSelectedTags] = useState([]);
  const [allTags, setAllTags] = useState([]);

  // WebLLM state
  const [webGPUSupported, setWebGPUSupported] = useState(null);
  const [webLLMConfig, setWebLLMConfig] = useState(null);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [modelLoadingText, setModelLoadingText] = useState('');

  const messagesEndRef = useRef(null);
  const abortControllerRef = useRef(null);
  const mlcEngineRef = useRef(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load initial selected summaries from localStorage
  useEffect(() => {
    const savedIds = JSON.parse(localStorage.getItem(CHAT_SELECTION_STORAGE_KEY) || '[]');
    const initialSelections = {};
    savedIds.forEach(id => {
      initialSelections[id] = true;
    });
    setSelectedSummaries(initialSelections);
  }, []);

  // Check WebGPU support on mount
  useEffect(() => {
    const checkWebGPUSupport = async () => {
      console.log('[WebLLM] Checking WebGPU support...');
      
      if (!navigator.gpu) {
        console.warn('[WebLLM] navigator.gpu not available - WebGPU not supported');
        setWebGPUSupported(false);
        return;
      }
      
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
          console.warn('[WebLLM] No GPU adapter available');
          setWebGPUSupported(false);
          return;
        }
        
        console.log('[WebLLM] WebGPU supported');
        setWebGPUSupported(true);
      } catch (error) {
        console.error('[WebLLM] WebGPU detection failed:', error);
        setWebGPUSupported(false);
      }
    };
    
    checkWebGPUSupport();
  }, []);

  // Load WebLLM configuration from backend
  const loadWebLLMConfig = useCallback(async () => {
    try {
      console.log('[WebLLM] Loading configuration...');
      const response = await fetch('/api/admin/config', {
        credentials: 'include'
      });
      
      if (!response.ok) {
        console.warn('[WebLLM] Failed to load config, using defaults');
        return {
          webllm_enabled: false,
          webllm_hf_model_url: 'HF://mlc-ai/Qwen3-0.6B-q4f16_1-MLC',
          webllm_system_prompt: 'You are a helpful AI assistant. Answer questions about the provided summaries concisely and accurately.',
          webllm_default_mode: 'cloud'
        };
      }
      
      const config = await response.json();
      
      const webLLMConfigData = {
        webllm_enabled: config.webllm_enabled === 'true' || config.webllm_enabled === true,
        webllm_hf_model_url: config.webllm_hf_model_url || 'HF://mlc-ai/Qwen3-0.6B-q4f16_1-MLC',
        webllm_system_prompt: config.webllm_system_prompt || 'You are a helpful AI assistant. Answer questions about the provided summaries concisely and accurately.',
        webllm_default_mode: config.webllm_default_mode || 'cloud'
      };
      
      console.log('[WebLLM] Configuration loaded:', webLLMConfigData);
      setWebLLMConfig(webLLMConfigData);
      
      // Set default mode from config
      if (webLLMConfigData.webllm_default_mode === 'local' && webGPUSupported) {
        setMode('webgpu');
      }
      
      return webLLMConfigData;
    } catch (error) {
      console.error('[WebLLM] Error loading config:', error);
      return {
        webllm_enabled: false,
        webllm_hf_model_url: 'HF://mlc-ai/Qwen3-0.6B-q4f16_1-MLC',
        webllm_system_prompt: 'You are a helpful AI assistant. Answer questions about the provided summaries concisely and accurately.',
        webllm_default_mode: 'cloud'
      };
    }
  }, [webGPUSupported]);

  // Load PublicAI configuration from backend
  const loadPublicAIConfig = useCallback(async () => {
    try {
      console.log('[PublicAI] Loading configuration...');
      const response = await fetch('/api/admin/config', {
        credentials: 'include'
      });

      if (!response.ok) {
        console.warn('[PublicAI] Failed to load config, using defaults');
        return {
          apiUrl: '',
          model: '',
          apiKey: '',
          systemPrompt: 'You are a helpful AI assistant.'
        };
      }

      const config = await response.json();

      const publicAIConfigData = {
        apiUrl: config.chat_publicai_api_url || '',
        model: config.chat_publicai_model || '',
        apiKey: config.chat_publicai_api_key || '',
        systemPrompt: config.chat_publicai_system_prompt || 'You are a helpful AI assistant.'
      };

      console.log('[PublicAI] Configuration loaded:', publicAIConfigData);
      return publicAIConfigData;
    } catch (error) {
      console.error('[PublicAI] Error loading config:', error);
      return {
        apiUrl: '',
        model: '',
        apiKey: '',
        systemPrompt: 'You are a helpful AI assistant.'
      };
    }
  }, []);

  /**
   * Scroll to bottom of messages
   */
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  /**
   * Initialize WebLLM engine
   */
  const initializeWebLLM = useCallback(async () => {
    console.log('[WebLLM] Initializing MLC engine...');

    if (mlcEngineRef.current) {
      console.log('[WebLLM] Engine already initialized');
      return mlcEngineRef.current;
    }

    try {
      setIsModelLoading(true);
      setModelLoadingProgress(0);
      setModelLoadingText('Initializing...');

      // Load config if not already loaded
      const config = webLLMConfig || await loadWebLLMConfig();

      if (!config.webllm_enabled) {
        throw new Error('WebLLM is not enabled in admin settings');
      }

      // Use installed @mlc-ai/web-llm package
      setModelLoadingText('Loading WebLLM library...');
      console.log('[WebLLM] Using installed @mlc-ai/web-llm package');

      console.log('[WebLLM] MLC module loaded, creating engine...');
      setModelLoadingText('Creating engine...');

      // Create engine with progress callback
      const engine = await CreateMLCEngine(
        config.webllm_hf_model_url,
        {
          initProgressCallback: (report) => {
            console.log('[WebLLM] Loading progress:', report);
            const progress = Math.round(report.progress * 100);
            setModelLoadingProgress(progress);
            setModelLoadingText(report.text || `Loading... ${progress}%`);
          }
        }
      );

      console.log('[WebLLM] Engine initialized successfully');
      mlcEngineRef.current = engine;
      setModelLoaded(true);
      setIsModelLoading(false);
      setModelLoadingProgress(100);

      return engine;
    } catch (error) {
      console.error('[WebLLM] Initialization failed:', error);
      setIsModelLoading(false);
      setModelLoadingProgress(0);
      setModelLoadingText('');
      throw error;
    }
  }, [webLLMConfig, loadWebLLMConfig]);

  /**
   * Send message using PublicAI endpoint (proxied through backend)
   */
  const sendMessagePublicAI = useCallback(async (userMessage, summaryIds) => {
    console.log('[PublicAI] Sending message via backend proxy:', userMessage);

    // Use backend proxy - CSP compliant
    const response = await sendArenaChatMessage(userMessage, summaryIds, abortControllerRef.current.signal, 'publicai');

    // Handle SSE streaming response (same as cloud mode)
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullAnswer = '';
    let assistantMessageAdded = false;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
            if (line.startsWith('data: ')) {
                try {
                    const data = JSON.parse(line.substring(6));

                    if (data.chunk) {
                        fullAnswer += data.chunk;
                        if (!assistantMessageAdded) {
                            setMessages(prev => [...prev, {
                                role: 'assistant',
                                content: fullAnswer,
                                timestamp: new Date()
                            }]);
                            assistantMessageAdded = true;
                        } else {
                            setMessages(prev => {
                                const updated = [...prev];
                                updated[updated.length - 1] = {
                                    role: 'assistant',
                                    content: fullAnswer,
                                    timestamp: new Date()
                                };
                                return updated;
                            });
                        }
                    }

                    if (data.isComplete) {
                        fullAnswer = data.answer || fullAnswer;
                        setMessages(prev => {
                            const updated = [...prev];
                            updated[updated.length - 1] = {
                                role: 'assistant',
                                content: fullAnswer,
                                timestamp: new Date()
                            };
                            return updated;
                        });
                    }
                } catch (e) {
                    // Skip parse errors
                }
            }
        }
    }
  }, []);

  /**
   * Send message using local WebLLM inference
   */
  const sendMessageLocalWebLLM = useCallback(async (userMessage, summaryIds) => {
    console.log('[WebLLM] Sending message locally:', userMessage);
    console.log('[WebLLM] Summary IDs:', summaryIds);

    try {
      // Check if engine is initialized
      let engine = mlcEngineRef.current;
      if (!engine || !modelLoaded) {
        console.log('[WebLLM] Model not loaded, initializing...');
        engine = await initializeWebLLM();

        if (!engine) {
          throw new Error('Failed to initialize WebLLM engine');
        }
      }

      // Get config for system prompt
      const config = webLLMConfig || await loadWebLLMConfig();

      // Prepare context from selected summaries
      let context = 'User wants to chat about the following summaries:\n\n';

      summaryIds.forEach(id => {
        const summary = allSummaries.find(s => s._id === id);
        if (summary) {
          context += `Summary (${summary.type || 'video'}): ${summary.title || 'Untitled'}\n`;
          if (summary.channel) context += `Channel: ${summary.channel}\n`;
          if (summary.tldr) {
            context += `TL;DR: ${summary.tldr.substring(0, 500)}${summary.tldr.length > 500 ? '...' : ''}\n`;
          }
          if (summary.description) {
            context += `Description: ${summary.description.substring(0, 500)}${summary.description.length > 500 ? '...' : ''}\n`;
          }
          context += '\n';
        }
      });

      console.log('[WebLLM] Context prepared, sending to model...');
      console.log('[WebLLM] Using system prompt:', config.webllm_system_prompt);

      // Add assistant message placeholder for streaming
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '',
        timestamp: new Date()
      }]);

      // Call chat completion with streaming
      const completion = await engine.chat.completions.create({
        model: config.webllm_hf_model_url,
        messages: [
          { role: 'system', content: config.webllm_system_prompt },
          { role: 'user', content: context + '\n\nUser question: ' + userMessage }
        ],
        stream: true,
        stream_options: {
          include_usage: true
        }
      });

      console.log('[WebLLM] Streaming started');

      // Process streaming response
      let fullContent = '';

      for await (const chunk of completion) {
        if (chunk.choices && chunk.choices[0] && chunk.choices[0].delta) {
          const delta = chunk.choices[0].delta;
          const content = delta.content || '';

          if (content) {
            fullContent += content;

            // Update the last message with streaming content
            setMessages(prev => {
              const updated = [...prev];
              if (updated.length > 0 && updated[updated.length - 1].role === 'assistant') {
                updated[updated.length - 1] = {
                  ...updated[updated.length - 1],
                  content: fullContent
                };
              }
              return updated;
            });
          }
        }
      }

      console.log('[WebLLM] Streaming complete');

      // Final update with complete content
      setMessages(prev => {
        const updated = [...prev];
        if (updated.length > 0 && updated[updated.length - 1].role === 'assistant') {
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content: fullContent
          };
        }
        return updated;
      });

      return fullContent;
    } catch (error) {
      console.error('[WebLLM] Local inference error:', error);
      throw error;
    }
  }, [allSummaries, modelLoaded, initializeWebLLM, webLLMConfig, loadWebLLMConfig]);

  /**
   * Send message - routes to cloud or local based on mode
   */
  const sendMessage = useCallback(async () => {
    if (!inputValue.trim() || isGenerating) return;

    const userMessage = inputValue.trim();
    setInputValue('');
    setIsGenerating(true);

    // Add user message to chat
    setMessages(prev => [...prev, { role: 'user', content: userMessage, timestamp: new Date() }]);

    // Create new AbortController for this request
    abortControllerRef.current = new AbortController();

    try {
      const summaryIds = Object.keys(selectedSummaries).filter(id => selectedSummaries[id]);
      
      if (summaryIds.length === 0) {
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: 'Please select at least one summary from the sidebar before chatting.',
          timestamp: new Date()
        }]);
        setIsGenerating(false);
        return;
      }

      // Route to PublicAI mode
      if (mode === 'publicai') {
        try {
          await sendMessagePublicAI(userMessage, summaryIds);
          setIsGenerating(false);
          return;
        } catch (error) {
          // Error already handled in sendMessagePublicAI
          setIsGenerating(false);
          return;
        }
      }

      // Route to local WebLLM if in webgpu mode
      if (mode === 'webgpu') {
        try {
          await sendMessageLocalWebLLM(userMessage, summaryIds);
          setIsGenerating(false);
          return;
        } catch (error) {
          // Error already handled in sendMessageLocalWebLLM
          setIsGenerating(false);
          return;
        }
      }

      // Cloud mode (MyCloud) - use existing SSE streaming
      const response = await sendArenaChatMessage(userMessage, summaryIds, abortControllerRef.current.signal, 'cloud');
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to send message: ${response.status}`);
      }

      // Check if response is SSE stream
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('text/event-stream')) {
        // Handle SSE streaming with proper parsing
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullAnswer = '';
        let reasoning = '';
        let assistantMessageAdded = false;

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
                
                // Handle streaming chunks
                if (data.chunk) {
                  fullAnswer += data.chunk;
                  if (!assistantMessageAdded) {
                    setMessages(prev => [...prev, { 
                      role: 'assistant', 
                      content: fullAnswer,
                      timestamp: new Date()
                    }]);
                    assistantMessageAdded = true;
                  } else {
                    setMessages(prev => {
                      const updated = [...prev];
                      updated[updated.length - 1] = {
                        role: 'assistant',
                        content: fullAnswer,
                        timestamp: new Date()
                      };
                      return updated;
                    });
                  }
                }
                
                // Handle final completion message
                if (data.isComplete) {
                  fullAnswer = data.answer || data.mainContent || fullAnswer;
                  reasoning = data.reasoning || '';
                  
                  setMessages(prev => {
                    const updated = [...prev];
                    updated[updated.length - 1] = {
                      role: 'assistant',
                      content: fullAnswer,
                      reasoning: reasoning,
                      metrics: data.metrics,
                      timestamp: new Date()
                    };
                    return updated;
                  });
                }
              } catch (e) {
                // Skip malformed JSON
                console.warn('SSE parse error:', e.message);
              }
            }
          }
        }
      } else {
        // Handle regular JSON response (fallback for non-streaming)
        const data = await response.json();
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: data.answer || data.response || 'No response received',
          reasoning: data.reasoning,
          metrics: data.metrics,
          timestamp: new Date()
        }]);
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Generation stopped by user');
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: '⚠️ Generation stopped by user.',
          timestamp: new Date()
        }]);
      } else {
        console.error('Error sending message:', error);
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: `Error: ${error.message}`,
          timestamp: new Date()
        }]);
      }
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  }, [inputValue, isGenerating, selectedSummaries, mode, sendMessagePublicAI, sendMessageLocalWebLLM]);

  /**
   * Stop generation
   */
  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  /**
   * Clear chat
   */
  const clearChat = useCallback(() => {
    setMessages([]);
  }, []);

  /**
   * Toggle summary selection
   */
  const toggleSummarySelection = useCallback((id) => {
    setSelectedSummaries(prev => {
      const newSelections = { ...prev };
      if (newSelections[id]) {
        delete newSelections[id];
      } else {
        newSelections[id] = true;
      }
      
      // Save to localStorage
      localStorage.setItem(
        CHAT_SELECTION_STORAGE_KEY, 
        JSON.stringify(Object.keys(newSelections))
      );
      
      return newSelections;
    });
  }, []);

  /**
   * Select all summaries
   */
  const selectAllSummaries = useCallback(() => {
    const newSelections = {};
    allSummaries.forEach(summary => {
      newSelections[summary._id] = true;
    });
    setSelectedSummaries(newSelections);
    localStorage.setItem(
      CHAT_SELECTION_STORAGE_KEY, 
      JSON.stringify(Object.keys(newSelections))
    );
  }, [allSummaries]);

  /**
   * Deselect all summaries
   */
  const deselectAllSummaries = useCallback(() => {
    setSelectedSummaries({});
    localStorage.setItem(CHAT_SELECTION_STORAGE_KEY, JSON.stringify([]));
  }, []);

  /**
   * Get selected summary count
   */
  const selectedSummaryCount = Object.keys(selectedSummaries).filter(id => selectedSummaries[id]).length;

  /**
   * Toggle tag selection
   */
  const toggleTagSelection = useCallback((tag) => {
    setSelectedTags(prev => {
      if (prev.includes(tag)) {
        return prev.filter(t => t !== tag);
      } else {
        return [...prev, tag];
      }
    });
  }, []);

  /**
   * Load WebGPU model (triggers WebLLM initialization)
   */
  const loadWebGPUModel = useCallback(async () => {
    if (mode !== 'webgpu' || modelLoaded) return;
    
    try {
      await initializeWebLLM();
    } catch (error) {
      console.error('Error loading WebGPU model:', error);
      // Add error message to chat
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: `❌ Failed to load WebLLM model: ${error.message}. Falling back to cloud mode.`,
        timestamp: new Date()
      }]);
      setMode('cloud');
    }
  }, [mode, modelLoaded, initializeWebLLM]);

  /**
   * Handle mode change
   */
  const handleModeChange = useCallback((newMode) => {
    setMode(newMode);
    if (newMode === 'webgpu' && !modelLoaded) {
      loadWebGPUModel();
    }
  }, [modelLoaded, loadWebGPUModel]);

  /**
   * Handle input key press
   */
  const handleKeyPress = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }, [sendMessage]);

  return {
    // Messages
    messages,
    setMessages,
    messagesEndRef,
    
    // Input
    inputValue,
    setInputValue,
    handleKeyPress,
    
    // Actions
    sendMessage,
    stopGeneration,
    clearChat,
    
    // State
    isGenerating,
    
    // Selections
    selectedSummaries,
    selectedSummaryCount,
    toggleSummarySelection,
    selectAllSummaries,
    deselectAllSummaries,
    
    // All summaries (for sidebar)
    allSummaries,
    setAllSummaries,
    
    // Tags
    allTags,
    setAllTags,
    selectedTags,
    toggleTagSelection,
    
    // Sidebar mode
    sidebarMode,
    setSidebarMode,
    
    // Chat mode
    mode,
    setMode: handleModeChange,
    
    // WebGPU / WebLLM
    modelLoadingProgress,
    modelLoaded,
    loadWebGPUModel,
    webGPUSupported,
    isModelLoading,
    modelLoadingText,
    webLLMConfig,
    
    // Helpers
    scrollToBottom
  };
}
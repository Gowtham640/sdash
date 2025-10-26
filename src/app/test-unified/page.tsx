'use client'

import { useState } from 'react';

interface UnifiedDataResponse {
  success: boolean;
  data?: {
    attendance?: Record<string, unknown>;
    marks?: Record<string, unknown>;
    timetable?: Record<string, unknown>;
    calendar?: Record<string, unknown>;
  };
  metadata?: {
    generated_at: string;
    source: string;
    email: string;
    total_data_types: number;
    successful_data_types: number;
    success_rate: string;
    cached?: boolean;
    cache_timestamp?: string;
  };
  error?: string;
}

export default function TestUnifiedPage() {
  const [data, setData] = useState<UnifiedDataResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, unknown> | null>(null);
  // Get email and password from localStorage since UserContext is not available
  const email = typeof window !== 'undefined' ? localStorage.getItem('user_email') || '' : '';
  const password = typeof window !== 'undefined' ? localStorage.getItem('user_password') || '' : '';
  const isAuthenticated = typeof window !== 'undefined' ? !!localStorage.getItem('user_email') : false;

  const testUnifiedEndpoint = async () => {
    if (!email || !password) {
      setError('Authentication required');
      return;
    }

    setLoading(true);
    setError(null);
    setData(null);

    try {
      const startTime = Date.now();
      
      const response = await fetch(`/api/data/all?email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`);
      const result: UnifiedDataResponse = await response.json();
      
      const endTime = Date.now();
      const duration = endTime - startTime;

      setData(result);
      
      // Test results summary
      setTestResults({
        duration: (duration / 1000).toFixed(2), // Convert to seconds
        success: result.success,
        dataTypes: result.data ? Object.keys(result.data) : [],
        successfulDataTypes: result.metadata?.successful_data_types || 0,
        totalDataTypes: result.metadata?.total_data_types || 0,
        successRate: result.metadata?.success_rate || '0%',
        cached: result.metadata?.cached || false
      });

    } catch (err) {
      setError(`Failed to fetch data: ${err instanceof Error ? err.message : 'Unknown error'}`);
      console.error('Error fetching unified data:', err);
    } finally {
      setLoading(false);
    }
  };

  const testIndividualEndpoints = async () => {
    if (!email || !password) {
      setError('Authentication required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const endpoints = ['attendance', 'marks', 'timetable', 'calender'];
      const results: Record<string, unknown> = {};
      
      for (const endpoint of endpoints) {
        const startTime = Date.now();
        try {
          const response = await fetch(`/api/data/${endpoint}?email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`);
          const result = await response.json();
          const endTime = Date.now();
          
          results[endpoint] = {
            success: result.success,
            duration: ((endTime - startTime) / 1000).toFixed(2), // Convert to seconds
            dataSize: result.data ? JSON.stringify(result.data).length : 0
          };
        } catch (err) {
          results[endpoint] = {
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error'
          };
        }
      }
      
      setTestResults({
        type: 'individual',
        results
      });

    } catch (err) {
      setError(`Failed to test individual endpoints: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-white text-xl">Please authenticate first</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold mb-8">Unified API Test Page</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
          <button
            onClick={testUnifiedEndpoint}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 px-6 py-3 rounded-lg font-semibold"
          >
            {loading ? 'Testing...' : 'Test Unified Endpoint'}
          </button>
          
          <button
            onClick={testIndividualEndpoints}
            disabled={loading}
            className="bg-green-600 hover:bg-green-700 disabled:bg-gray-600 px-6 py-3 rounded-lg font-semibold"
          >
            {loading ? 'Testing...' : 'Test Individual Endpoints'}
          </button>
        </div>

        {error && (
          <div className="bg-red-900 border border-red-700 text-red-100 px-4 py-3 rounded mb-8">
            <strong>Error:</strong> {error}
          </div>
        )}

        {testResults && (
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 mb-8">
            <h2 className="text-2xl font-bold mb-4">Test Results</h2>
            
            {testResults.type === 'individual' ? (
              <div>
                <h3 className="text-xl font-semibold mb-3">Individual Endpoints Performance:</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {testResults.results && typeof testResults.results === 'object' ? Object.entries(testResults.results as Record<string, unknown>).map(([endpoint, result]) => {
                    const typedResult = result as { success?: boolean; duration?: number; dataSize?: number; error?: string };
                    return (
                    <div key={endpoint} className="bg-gray-800 p-4 rounded">
                      <h4 className="font-semibold capitalize">{endpoint}</h4>
                      <p className="text-sm">
                        <span className={typedResult.success ? 'text-green-400' : 'text-red-400'}>
                          {typedResult.success ? '✓ Success' : '✗ Failed'}
                        </span>
                      </p>
                      {typedResult.duration && (
                        <p className="text-sm text-gray-400">
                          Duration: {typedResult.duration}s
                        </p>
                      )}
                      {typedResult.dataSize && (
                        <p className="text-sm text-gray-400">
                          Size: {typedResult.dataSize} bytes
                        </p>
                      )}
                      {typedResult.error && (
                        <p className="text-sm text-red-400">
                          Error: {typedResult.error}
                        </p>
                      )}
                    </div>
                  );
                  }) : null}
                </div>
              </div>
            ) : (
              <div>
                <h3 className="text-xl font-semibold mb-3">Unified Endpoint Performance:</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div className="bg-gray-800 p-4 rounded">
                    <h4 className="font-semibold">Duration</h4>
                    <p className="text-lg font-bold text-blue-400">{testResults.duration}s</p>
                  </div>
                  <div className="bg-gray-800 p-4 rounded">
                    <h4 className="font-semibold">Success Rate</h4>
                    <p className="text-lg font-bold text-green-400">{testResults.successRate}</p>
                  </div>
                  <div className="bg-gray-800 p-4 rounded">
                    <h4 className="font-semibold">Data Types</h4>
                    <p className="text-lg font-bold text-purple-400">{testResults.successfulDataTypes}/{testResults.totalDataTypes}</p>
                  </div>
                <div className="bg-gray-800 p-4 rounded">
                  <h4 className="font-semibold">Cached</h4>
                  <p className="text-lg font-bold text-orange-400">{testResults.cached ? 'Yes' : 'No'}</p>
                </div>
                <div className="bg-gray-800 p-4 rounded">
                  <h4 className="font-semibold">Optimized</h4>
                  <p className="text-lg font-bold text-green-400">Phase 1+</p>
                </div>
                </div>
                
                <div className="bg-gray-800 p-4 rounded">
                  <h4 className="font-semibold mb-2">Available Data Types:</h4>
                  <div className="flex flex-wrap gap-2">
                    {testResults.dataTypes.map((type: string) => (
                      <span key={type} className="bg-blue-600 px-3 py-1 rounded-full text-sm">
                        {type}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {data && (
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-6">
            <h2 className="text-2xl font-bold mb-4">Unified Data Response</h2>
            
            <div className="mb-4">
              <h3 className="text-lg font-semibold mb-2">Metadata:</h3>
              <pre className="bg-gray-800 p-4 rounded text-sm overflow-auto">
                {JSON.stringify(data.metadata, null, 2)}
              </pre>
            </div>

            <div className="mb-4">
              <h3 className="text-lg font-semibold mb-2">Data Summary:</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {data.data && typeof data.data === 'object' ? Object.entries(data.data as Record<string, unknown>).map(([type, typeData]) => {
                  const typedTypeData = typeData as { success?: boolean; count?: number; error?: string };
                  return (
                  <div key={type} className="bg-gray-800 p-4 rounded">
                    <h4 className="font-semibold capitalize mb-2">{type}</h4>
                    <p className="text-sm">
                      <span className={typedTypeData.success ? 'text-green-400' : 'text-red-400'}>
                        {typedTypeData.success ? '✓ Available' : '✗ Failed'}
                      </span>
                    </p>
                    {typedTypeData.count && (
                      <p className="text-sm text-gray-400">
                        Count: {typedTypeData.count}
                      </p>
                    )}
                    {typedTypeData.error && (
                      <p className="text-sm text-red-400">
                        Error: {typedTypeData.error}
                      </p>
                    )}
                  </div>
                );
                }) : null}
              </div>
            </div>

            <details className="mt-4">
              <summary className="cursor-pointer text-lg font-semibold">Full Response Data</summary>
              <pre className="bg-gray-800 p-4 rounded text-sm overflow-auto mt-2 max-h-96">
                {JSON.stringify(data, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}


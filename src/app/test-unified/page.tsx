'use client'

import { useState } from 'react';
import { useUser } from '@/contexts/UserContext';

interface UnifiedDataResponse {
  success: boolean;
  data?: {
    attendance?: any;
    marks?: any;
    timetable?: any;
    calendar?: any;
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
  const [testResults, setTestResults] = useState<any>(null);
  const { email, password, isAuthenticated } = useUser();

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
      const results: any = {};
      
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
                  {Object.entries(testResults.results).map(([endpoint, result]: [string, any]) => (
                    <div key={endpoint} className="bg-gray-800 p-4 rounded">
                      <h4 className="font-semibold capitalize">{endpoint}</h4>
                      <p className="text-sm">
                        <span className={result.success ? 'text-green-400' : 'text-red-400'}>
                          {result.success ? '✓ Success' : '✗ Failed'}
                        </span>
                      </p>
                      {result.duration && (
                        <p className="text-sm text-gray-400">
                          Duration: {result.duration}s
                        </p>
                      )}
                      {result.dataSize && (
                        <p className="text-sm text-gray-400">
                          Size: {result.dataSize} bytes
                        </p>
                      )}
                      {result.error && (
                        <p className="text-sm text-red-400">
                          Error: {result.error}
                        </p>
                      )}
                    </div>
                  ))}
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
                {data.data && Object.entries(data.data).map(([type, typeData]: [string, any]) => (
                  <div key={type} className="bg-gray-800 p-4 rounded">
                    <h4 className="font-semibold capitalize mb-2">{type}</h4>
                    <p className="text-sm">
                      <span className={typeData.success ? 'text-green-400' : 'text-red-400'}>
                        {typeData.success ? '✓ Available' : '✗ Failed'}
                      </span>
                    </p>
                    {typeData.count && (
                      <p className="text-sm text-gray-400">
                        Count: {typeData.count}
                      </p>
                    )}
                    {typeData.error && (
                      <p className="text-sm text-red-400">
                        Error: {typeData.error}
                      </p>
                    )}
                  </div>
                ))}
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


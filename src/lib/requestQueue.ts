/**
 * Track concurrent requests to backend API
 * Used to detect high load and trigger early refresh
 */
class RequestQueueTracker {
  private pendingRequests = new Map<string, number>(); // email -> request count
  private requestStartTimes = new Map<string, number[]>(); // email -> [start times]
  
  // Track backend requests (waiting for Render Python scraper)
  private pendingBackendRequests = new Map<string, number>(); // email -> backend request count
  private backendRequestStartTimes = new Map<string, number[]>(); // email -> [start times]
  
  /**
   * Register a request start
   */
  registerRequest(email: string): void {
    const count = this.pendingRequests.get(email) || 0;
    this.pendingRequests.set(email, count + 1);
    
    const times = this.requestStartTimes.get(email) || [];
    times.push(Date.now());
    this.requestStartTimes.set(email, times);
    
    console.log(`[QueueTracker] Request registered for ${email} (pending: ${count + 1})`);
  }
  
  /**
   * Unregister a request end
   */
  unregisterRequest(email: string): void {
    const count = this.pendingRequests.get(email) || 0;
    if (count > 0) {
      this.pendingRequests.set(email, count - 1);
      console.log(`[QueueTracker] Request unregistered for ${email} (pending: ${count - 1})`);
    }
    
    // Clean up old start times (older than 1 minute)
    const times = this.requestStartTimes.get(email) || [];
    const oneMinuteAgo = Date.now() - 60 * 1000;
    const recentTimes = times.filter(time => time > oneMinuteAgo);
    this.requestStartTimes.set(email, recentTimes);
  }
  
  /**
   * Get number of pending requests for a user
   */
  getPendingCount(email: string): number {
    return this.pendingRequests.get(email) || 0;
  }
  
  /**
   * Get total concurrent requests (all users)
   */
  getTotalPendingCount(): number {
    return Array.from(this.pendingRequests.values()).reduce((sum, count) => sum + count, 0);
  }
  
  /**
   * Get requests in last minute for a user (indicates recent activity)
   */
  getRecentRequestCount(email: string): number {
    const times = this.requestStartTimes.get(email) || [];
    const oneMinuteAgo = Date.now() - 60 * 1000;
    return times.filter(time => time > oneMinuteAgo).length;
  }
  
  /**
   * Register a backend request start (when calling Python scraper on Render)
   */
  registerBackendRequest(email: string): void {
    const count = this.pendingBackendRequests.get(email) || 0;
    this.pendingBackendRequests.set(email, count + 1);
    
    const times = this.backendRequestStartTimes.get(email) || [];
    times.push(Date.now());
    this.backendRequestStartTimes.set(email, times);
    
    console.log(`[QueueTracker] Backend request registered for ${email} (pending: ${count + 1})`);
  }
  
  /**
   * Unregister a backend request end
   */
  unregisterBackendRequest(email: string): void {
    const count = this.pendingBackendRequests.get(email) || 0;
    if (count > 0) {
      this.pendingBackendRequests.set(email, count - 1);
      console.log(`[QueueTracker] Backend request unregistered for ${email} (pending: ${count - 1})`);
    }
    
    // Clean up old start times (older than 1 minute)
    const times = this.backendRequestStartTimes.get(email) || [];
    const oneMinuteAgo = Date.now() - 60 * 1000;
    const recentTimes = times.filter(time => time > oneMinuteAgo);
    this.backendRequestStartTimes.set(email, recentTimes);
  }
  
  /**
   * Get number of pending backend requests for a user
   */
  getPendingBackendCount(email: string): number {
    return this.pendingBackendRequests.get(email) || 0;
  }
  
  /**
   * Get total concurrent backend requests (all users)
   */
  getTotalPendingBackendCount(): number {
    return Array.from(this.pendingBackendRequests.values()).reduce((sum, count) => sum + count, 0);
  }
  
  /**
   * Get backend requests in last minute for a user
   */
  getRecentBackendRequestCount(email: string): number {
    const times = this.backendRequestStartTimes.get(email) || [];
    const oneMinuteAgo = Date.now() - 60 * 1000;
    return times.filter(time => time > oneMinuteAgo).length;
  }
  
  /**
   * Get backend queue info for a specific user
   */
  getBackendQueueInfo(email: string): {
    pending_backend_requests: number;
    total_pending_backend_requests: number;
    recent_backend_requests_last_minute: number;
  } {
    return {
      pending_backend_requests: this.getPendingBackendCount(email),
      total_pending_backend_requests: this.getTotalPendingBackendCount(),
      recent_backend_requests_last_minute: this.getRecentBackendRequestCount(email)
    };
  }
  
  /**
   * Get queue info for a specific user (includes backend queue)
   */
  getQueueInfo(email: string): {
    pending_requests: number;
    total_pending_requests: number;
    recent_requests_last_minute: number;
    backend_queue: {
      pending_backend_requests: number;
      total_pending_backend_requests: number;
      recent_backend_requests_last_minute: number;
    };
  } {
    return {
      pending_requests: this.getPendingCount(email),
      total_pending_requests: this.getTotalPendingCount(),
      recent_requests_last_minute: this.getRecentRequestCount(email),
      backend_queue: this.getBackendQueueInfo(email)
    };
  }
}

// Singleton instance (shared across all requests in the same process)
export const requestQueueTracker = new RequestQueueTracker();

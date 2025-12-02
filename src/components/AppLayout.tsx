'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { getStorageItem } from '@/lib/browserStorage';

interface AppLayoutProps {
  children: React.ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
  const [isAdmin, setIsAdmin] = useState(false);

  const checkAdminStatus = async () => {
    try {
      const access_token = getStorageItem('access_token');
      if (!access_token) {
        setIsAdmin(false);
        return;
      }

      const response = await fetch('/api/admin/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token })
      });

      const result = await response.json();
      setIsAdmin(result.success === true && result.isAdmin === true);
    } catch (err) {
      console.error('[AppLayout] Error checking admin status:', err);
      setIsAdmin(false);
    }
  };

  useEffect(() => {
    checkAdminStatus();
  }, []);

  return (
    <div className="relative bg-black min-h-screen flex overflow-hidden">
      {/* Left Sidebar */}
      <div className="w-64 bg-white/5 backdrop-blur-md border-r border-white/10 flex flex-col p-6">
        {/* Logo Section */}
        <div className="mb-8 ml-3.5 mt-3">
          <h1 className="text-white text-5xl font-sora font-bold">SDash</h1>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 space-y-2">
          <Link
            href="/dashboard"
            className="block px-4 py-3 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-all font-sora text-sm"
          >
            Dashboard
          </Link>
          <Link
            href="/timetable"
            className="block px-4 py-3 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-all font-sora text-sm"
          >
            TimeTable
          </Link>
          <Link
            href="/attendance"
            className="block px-4 py-3 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-all font-sora text-sm"
          >
            Attendance
          </Link>
          <Link
            href="/marks"
            className="block px-4 py-3 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-all font-sora text-sm"
          >
            Marks
          </Link>
          <Link
            href="/calender"
            className="block px-4 py-3 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-all font-sora text-sm"
          >
            Calendar
          </Link>
          {isAdmin && (
            <Link
              href="/admin"
              className="block px-4 py-3 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-all font-sora text-sm"
            >
              Admin
            </Link>
          )}
        </nav>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>
    </div>
  );
}

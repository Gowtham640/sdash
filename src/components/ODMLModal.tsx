'use client';

import React, { useState } from 'react';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { DateRange } from 'react-day-picker';
import { 
  formatDateRange, 
  validateODMLDateRange,
  type AttendanceData,
  type LeavePeriod
} from '@/lib/attendancePrediction';
import { type SlotOccurrence } from '@/lib/timetableUtils';

interface ODMLModalProps {
  attendanceData: AttendanceData | null;
  slotOccurrences: SlotOccurrence[];
  calendarData: any[];
  isOpen: boolean;
  onClose: () => void;
  onCalculate: (odmlPeriods: LeavePeriod[]) => void;
  odmlPeriods: LeavePeriod[];
  setOdmlPeriods: (periods: LeavePeriod[]) => void;
  isCalculating: boolean;
}

export const ODMLModal: React.FC<ODMLModalProps> = ({
  attendanceData,
  slotOccurrences,
  calendarData,
  isOpen,
  onClose,
  onCalculate,
  odmlPeriods,
  setOdmlPeriods,
  isCalculating
}) => {
  const [error, setError] = useState<string | null>(null);
  const [currentDateRange, setCurrentDateRange] = useState<DateRange | undefined>({
    from: undefined,
    to: undefined
  });

  const addODMLPeriod = () => {
    if (!currentDateRange?.from || !currentDateRange?.to) {
      setError('Please select a date range first');
      return;
    }

    // Validate the current date range
    const validation = validateODMLDateRange(currentDateRange.from, currentDateRange.to);
    if (!validation.isValid) {
      setError(validation.error || 'Invalid date range');
      return;
    }

    // Check for overlaps with existing periods
    const newPeriod: LeavePeriod = {
      from: currentDateRange.from,
      to: currentDateRange.to,
      id: `odml_${Date.now()}`
    };

    const allPeriods = [...odmlPeriods, newPeriod];
    const overlapValidation = validateODMLPeriods(allPeriods);
    if (!overlapValidation.isValid) {
      setError(overlapValidation.error || 'OD/ML periods cannot overlap');
      return;
    }

    setOdmlPeriods(allPeriods);
    setCurrentDateRange({ from: undefined, to: undefined });
    setError(null);
  };

  const removeODMLPeriod = (periodId: string) => {
    setOdmlPeriods(odmlPeriods.filter(p => p.id !== periodId));
  };

  const handleCalculate = async () => {
    if (odmlPeriods.length === 0) {
      setError('Please add at least one OD/ML period');
      return;
    }

    // Validate all OD/ML periods
    const validation = validateODMLPeriods(odmlPeriods);
    if (!validation.isValid) {
      setError(validation.error || 'Invalid OD/ML periods');
      return;
    }

    setError(null);
    onCalculate(odmlPeriods);
  };

  const handleClose = () => {
    setError(null);
    onClose();
  };

  // Validate OD/ML periods (similar to leave periods but with different messaging)
  const validateODMLPeriods = (periods: LeavePeriod[]): { isValid: boolean; error?: string } => {
    if (periods.length === 0) {
      return { isValid: false, error: 'Please add at least one OD/ML period' };
    }

    for (let i = 0; i < periods.length; i++) {
      const period = periods[i];
      
      // Validate individual period
      const validation = validateODMLDateRange(period.from, period.to);
      if (!validation.isValid) {
        return { isValid: false, error: `OD/ML Period ${i + 1}: ${validation.error}` };
      }

      // Check for overlaps with other periods
      for (let j = i + 1; j < periods.length; j++) {
        const otherPeriod = periods[j];
        // Allow same day periods if they're exactly the same date range
        if (period.from.getTime() === otherPeriod.from.getTime() && 
            period.to.getTime() === otherPeriod.to.getTime()) {
          return { isValid: false, error: `OD/ML Period ${i + 1} is identical to period ${j + 1}` };
        }
        // Check for actual overlaps (not just same day)
        if (period.from < otherPeriod.to && period.to > otherPeriod.from) {
          return { isValid: false, error: `OD/ML Period ${i + 1} overlaps with period ${j + 1}` };
        }
      }
    }

    return { isValid: true };
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-black border border-white/20 rounded-3xl p-6 max-w-6xl w-auto max-h-[90vh] items-center overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-white font-sora text-2xl font-bold">📋 OD/ML Management</h2>
          <Button 
            onClick={handleClose}
            variant="ghost"
            className="text-white hover:bg-white/20"
          >
            ✕
          </Button>
        </div>

        {/* Add New OD/ML Period */}
        <div className="mb-6">
          <label className="text-white font-sora text-lg font-bold mb-3 block">
            Add OD/ML Period:
          </label>
          <div className="bg-white/10 border border-white/20 rounded-2xl p-钢笔">
            <Calendar
              mode="range"
              selected={currentDateRange}
              onSelect={(range) => setCurrentDateRange(range)}
              className="text-white bg-transparent font-sora"
              classNames={{
                root: "bg-transparent text-white",
                months: "bg-transparent",
                month: "bg-transparent",
                nav: "bg-transparent",
                button_previous: "text-white hover:bg-white/20",
                button_next: "text-white hover:bg-white/20",
                month_caption: "text-white",
                caption_label: "text-white font-sora",
                table: "bg-transparent",
                weekdays: "bg-transparent",
                weekday: "text-white/70 font-sora",
                week: "bg-transparent",
                day: "text-white hover:bg-white/20 hover:text-white",
                day_selected: "bg-green-500 text-white hover:bg-green-600",
                day_range_start: "bg-green-500 text-white hover:bg-green-600",
                day_range_end: "bg-green-500 text-white hover:bg-green-600",
                day_range_middle: "bg-green-500/50 text-white hover:bg-green-500/70",
                day_today: "bg-white/20 text-black font-bold hover:bg-white/30",
                day_outside: "text-white/50 hover:text-white/70",
                day_disabled: "text-white/30 hover:text-white/30",
              }}
            />
          </div>
          
          {currentDateRange?.from && currentDateRange?.to && (
            <div className="mt-3 flex items-center gap-4">
              <div className="text-white/80 font-sora text-sm">
                Selected: {formatDateRange(currentDateRange.from, currentDateRange.to)}
              </div>
              <Button 
                onClick={addODMLPeriod}
                className="bg-green-600 hover:bg-green-700 text-white font-sora px-4 py-2 rounded-xl"
              >
                Add OD/ML
              </Button>
            </div>
          )}
        </div>

        {/* OD/ML Periods List */}
        {odmlPeriods.length > 0 && (
          <div className="mb-6">
            <label className="text-white font-sora text-lg font-bold mb-3 block">
              OD/ML Periods ({odmlPeriods.length}):
            </label>
            <div className="space-y-2">
              {odmlPeriods.map((period, index) => (
                <div key={period.id} className="bg-white/10 border border-white/20 rounded-2xl p-4 flex items-center justify-between">
                  <div className="text-white font-sora">
                    <span className="text-green-400">OD/ML {index + 1}:</span> {formatDateRange(period.from, period.to)}
                    {period.from.getTime() === period.to.getTime() && (
                      <span className="text-green-400 ml-2"></span>
                    )}
                  </div>
                  <Button 
                    onClick={() => removeODMLPeriod(period.id)}
                    className="bg-red-600 hover:bg-red-700 text-white font-sora px-2 rounded-lg text-sm"
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Calculate Button */}
        <div className="mb-6">
          <Button 
            onClick={handleCalculate}
            disabled={odmlPeriods.length === 0 || isCalculating}
            className="bg-green-600 hover:bg-green-700 text-white font-sora"
          >
            {isCalculating ? 'Calculating...' : 'Apply OD/ML'}
          </Button>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-2xl">
            <p className="text-red-400 font-sora">{error}</p>
          </div>
        )}

      </div>
    </div>
  );
};

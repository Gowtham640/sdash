'use client';

import React, { useState } from 'react';
import PillNav from '../../components/PillNav';
import Link from "next/link";
import { Copy, Trash2 } from 'lucide-react';
interface SubjectRow {
  id: string;
  credit: string;
  grade: string;
}

const GRADE_POINTS: Record<string, number> = {
  O: 10,
  'A+': 9,
  A: 8,
  'B+': 7,
  B: 6,
  C: 5,
  F: 0,
};

const GRADES = ['O', 'A+', 'A', 'B+', 'B', 'C', 'F'];

export default function SGPACalculatorPage() {
  const [rows, setRows] = useState<SubjectRow[]>([
    { id: '1', credit: '', grade: '' },
  ]);
  const [sgpa, setSgpa] = useState<number | null>(null);

  const addRow = () => {
    setRows([...rows, { id: Date.now().toString(), credit: '', grade: '' }]);
  };

  const deleteRow = (id: string) => {
    if (rows.length > 1) {
      setRows(rows.filter((row) => row.id !== id));
    }
  };

  const duplicateRow = (id: string) => {
    const row = rows.find((r) => r.id === id);
    if (row) {
      setRows([...rows, { ...row, id: Date.now().toString() }]);
    }
  };

  const updateRow = (
    id: string,
    field: 'credit' | 'grade',
    value: string
  ) => {
    setRows(rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  };

  const calculateSGPA = () => {
    let totalCredits = 0;
    let totalGradePoints = 0;

    rows.forEach((row) => {
      const credit = Number(row.credit);
      const gp = GRADE_POINTS[row.grade];
      if (credit > 0 && gp !== undefined) {
        totalCredits += credit;
        totalGradePoints += credit * gp;
      }
    });

    setSgpa(
      totalCredits > 0
        ? Math.round((totalGradePoints / totalCredits) * 100) / 100
        : null
    );
  };

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Home Icon */}
      <Link
        href="/dashboard"
        className="absolute top-2 sm:top-4 left-2 sm:left-4 text-white hover:text-white/80 transition-colors z-50"
        aria-label="Go to Dashboard"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          className="w-5 h-5 sm:w-6 sm:h-6"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
        </svg>
      </Link>

      <div className="container mx-auto px-2 sm:px-4 py-4 sm:py-8 pt-20 sm:pt-24">
        <div className="max-w-4xl mx-auto font-sora">
          <div className="relative p-3 sm:p-6 backdrop-blur bg-white/10 border border-white/20 rounded-3xl">
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-center mb-4 sm:mb-6">
              SGPA Calculator
            </h1>

            <div className="overflow-x-auto">
                <table className="w-full min-w-[300px] mb-4 sm:mb-6">
                <thead>
                  <tr className="border-b border-white/20">
                    <th className="text-left p-2 sm:p-3 text-sm sm:text-base">Credit</th>
                    <th className="text-left p-2 sm:p-3 text-sm sm:text-base">Grade</th>
                    <th className="text-left p-2 sm:p-3 text-sm sm:text-base">Actions</th>
                  </tr>
                </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-white/10">
                    <td className="p-2 sm:p-3">
                      <input
                        type="number"
                        value={row.credit}
                        onChange={(e) =>
                          updateRow(row.id, 'credit', e.target.value)
                        }
                        className="w-full bg-white/10 rounded p-1.5 sm:p-2 text-sm sm:text-base"
                        placeholder="Credits"
                      />
                    </td>
                    <td className="p-2 sm:p-3">
                      <select
                        value={row.grade}
                        onChange={(e) =>
                          updateRow(row.id, 'grade', e.target.value)
                        }
                        className="w-full bg-gray-800 text-white rounded p-1.5 sm:p-2 border border-gray-600 text-sm sm:text-base"
                      >
                        <option value="" className="bg-gray-800 text-white">Select</option>
                        {GRADES.map((g) => (
                          <option key={g} value={g} className="bg-gray-800 text-white">
                            {g}
                          </option>
                        ))}
                      </select>
                    </td>
                      <td className="p-2 sm:p-3 flex gap-1 sm:gap-2">
                        <button
                          onClick={() => duplicateRow(row.id)}
                          className=" hover:text-blue-700 text-white p-1.5 sm:p-2 rounded transition-colors"
                          title="Duplicate row"
                        >
                          <Copy size={14} className="sm:w-4 sm:h-4" />
                        </button>
                        {rows.length > 1 && (
                          <button
                            onClick={() => deleteRow(row.id)}
                            className=" hover:text-red-500 text-white p-1.5 sm:p-2 rounded transition-colors"
                            title="Delete row"
                          >
                            <Trash2 size={14} className="sm:w-4 sm:h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col sm:flex-row justify-between gap-3 sm:gap-0">
              <button
                onClick={addRow}
                className='bg-white text-gray-700 hover:bg-gray-200 px-4 sm:px-6 py-2 rounded transition-colors text-sm sm:text-base'
              >
                Add Row
              </button>
              <button
                onClick={calculateSGPA}
                className='bg-green-600 hover:bg-green-700 text-white px-4 sm:px-6 py-2 rounded transition-colors text-sm sm:text-base'
              >
                Calculate SGPA
              </button>
            </div>

            {sgpa !== null && (
              <div className="mt-4 sm:mt-6 text-center">
                <div className="text-lg sm:text-xl font-semibold text-white mb-2">Your SGPA</div>
                <div className="text-3xl sm:text-4xl md:text-5xl font-bold text-green-400">
                  {sgpa}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export {};

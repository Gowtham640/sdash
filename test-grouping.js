// Test script to verify slot grouping
const testData = {
  timetable: {
    'DO 1': {
      time_slots: {
        '09:45-10:35': {
          slot_code: 'P3/X',
          course_title: 'Data Structures and Algorithms',
          slot_type: 'Lab'
        },
        '10:40-11:30': {
          slot_code: 'P4',
          course_title: 'Data Structures and Algorithms',
          slot_type: 'Lab'
        },
        '12:30-01:20': {
          slot_code: 'A',
          course_title: 'Transforms and Boundary Value Problems',
          slot_type: 'Theory'
        }
      }
    },
    'DO 2': {
      time_slots: {
        '09:45-10:35': {
          slot_code: 'P3',
          course_title: 'Data Structures and Algorithms',
          slot_type: 'Lab'
        },
        '10:40-11:30': {
          slot_code: 'P4',
          course_title: 'Data Structures and Algorithms',
          slot_type: 'Lab'
        }
      }
    }
  }
};

// Simulate the grouping logic
function getSlotOccurrences(timetableData) {
  const courseMap = new Map();
  const slotMap = new Map();

  ['DO 1', 'DO 2', 'DO 3', 'DO 4', 'DO 5'].forEach(doName => {
    const doData = timetableData.timetable[doName];
    const doNumber = parseInt(doName.split(' ')[1]);
    
    if (doData && doData.time_slots) {
      Object.values(doData.time_slots).forEach((slotInfo) => {
        if (slotInfo.slot_code && slotInfo.course_title && slotInfo.course_title.trim() !== '') {
          const slot = slotInfo.slot_code;
          const courseTitle = slotInfo.course_title.trim();
          const category = slotInfo.slot_type === 'Lab' ? 'Lab' : 'Theory';
          
          const key = `${courseTitle}-${category}`;
          
          if (!courseMap.has(key)) {
            courseMap.set(key, {
              slot: '',
              courseTitle,
              category,
              dayOrders: [],
              totalOccurrences: 0
            });
            slotMap.set(key, new Set());
          }
          
          const courseOccurrence = courseMap.get(key);
          const slotSet = slotMap.get(key);
          
          slotSet.add(slot);
          
          if (!courseOccurrence.dayOrders.includes(doNumber)) {
            courseOccurrence.dayOrders.push(doNumber);
          }
          courseOccurrence.totalOccurrences++;
        }
      });
    }
  });

  courseMap.forEach((occurrence, key) => {
    const slotSet = slotMap.get(key);
    occurrence.slot = Array.from(slotSet).sort().join(', ');
  });

  return Array.from(courseMap.values());
}

const result = getSlotOccurrences(testData);
console.log('Test Result:');
console.log(JSON.stringify(result, null, 2));


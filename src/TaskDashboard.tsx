/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  collection, 
  query, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  serverTimestamp, 
  orderBy,
  where,
  Timestamp,
  deleteField
} from 'firebase/firestore';
import { signOut, User } from 'firebase/auth';
import { db, auth } from './lib/firebase';
import { AppUser, Task, TaskNote, ACTION_OPTIONS, STATUS_UPDATE_OPTIONS, OperationType, FirestoreErrorInfo } from './types';
import { 
  Plus, 
  Download, 
  FileText, 
  Trash2, 
  Edit2, 
  LogOut, 
  Search, 
  Filter,
  CheckCircle2,
  Clock,
  AlertCircle,
  X,
  ChevronDown,
  UserCircle2,
  ListTodo,
  CheckSquare,
  Square,
  PlusCircle,
  Image as ImageIcon,
  Calendar
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';

// --- Error Handling ---

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  // In a real app, we'd show this to the user via a toast or error boundary
  return errInfo;
}

// --- Components ---

interface Props {
  user: User;
  appUser: AppUser;
  projectUsers: AppUser[];
  onLogout: () => void;
}

const getImageUrl = (url: string) => {
  if (url.includes('drive.google.com/uc') || url.includes('docs.google.com/uc')) {
    const match = url.match(/[?&]id=([^&]+)/);
    if (match) {
      return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w1000`;
    }
  }
  return url;
};

export default function TaskDashboard({ user, appUser, projectUsers, onLogout }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [assignedToFilter, setAssignedToFilter] = useState<string>('All');
  const isSuperUser = user?.email === 'n.anwar@eprom.com' || user?.email === 'tarekmoh123@gmail.com';

  const [currentView, setCurrentView] = useState<'department' | 'my-assignments' | 'outstanding'>(
    isSuperUser ? 'department' : 'my-assignments'
  );

  useEffect(() => {
    if (!isSuperUser && currentView === 'department') {
      setCurrentView('my-assignments');
    }
  }, [isSuperUser, currentView]);

  const [error, setError] = useState<string | null>(null);
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);
  const [attachmentToDelete, setAttachmentToDelete] = useState<Task | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    taskName: '',
    status: 'Pending' as Task['status'],
    description: '',
    statusUpdate: STATUS_UPDATE_OPTIONS[0],
    assignedTo: '',
    waitingOn: '',
    requiredAction: ACTION_OPTIONS[0],
    notes: [] as TaskNote[],
    dueDate: '',
    priority: 'Medium' as NonNullable<Task['priority']>,
    attachedFile: '',
    attachedFileName: '',
    serialNumber: ''
  });
  const [newNoteText, setNewNoteText] = useState('');

  // Firestore Listener
  useEffect(() => {
    let q;
    if (appUser.role === 'Admin') {
      q = query(collection(db, 'tasks'), orderBy('createdAt', 'desc'));
    } else {
      q = query(
        collection(db, 'tasks'),
        where('teamId', '==', appUser.teamId || 'NONE'),
        orderBy('createdAt', 'desc')
      );
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const taskList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Task[];
      setTasks(taskList);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'tasks');
      setError('Failed to load tasks. Please check your permissions.');
    });

    return () => unsubscribe();
  }, [user, appUser]);

  // Notifications logic
  const previousTasksRef = useRef<Task[]>([]);
  const notifiedNearEndDatesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    if (!user) return;

    const previousTasksMap = new Map<string, Task>(previousTasksRef.current.map(t => [t.id, t]));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    tasks.forEach(task => {
      // 1. New Assignments and Waiting On (Skip on initial load)
      if (previousTasksRef.current.length > 0) {
        const prevTask = previousTasksMap.get(task.id);
        const assigned = task.assignedTo;
        const prevAssigned = prevTask?.assignedTo;

        const isNewlyAssigned = assigned === user.displayName && prevAssigned !== user.displayName;
        const isNewlyWaitingOn = task.waitingOn === user.displayName && prevTask?.waitingOn !== user.displayName;

        if ('Notification' in window && Notification.permission === 'granted') {
          if (isNewlyAssigned) {
            new Notification('New Task Assigned', {
              body: `You have been assigned to: ${task.taskName}`
            });
          }
          if (isNewlyWaitingOn) {
            new Notification('Action Required', {
              body: `Task "${task.taskName}" is now waiting on you.`
            });
          }
        }
      }

      // 2. Nearing Due Date
      if (task.assignedTo === user.displayName && task.dueDate && task.status !== 'Done') {
        const dueDateVal = new Date(task.dueDate);
        dueDateVal.setHours(0, 0, 0, 0);
        const diffTime = dueDateVal.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays >= 0 && diffDays <= 3 && !notifiedNearEndDatesRef.current.has(task.id)) {
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('Task Nearing Due Date', {
              body: `"${task.taskName}" is due in ${diffDays} day(s).`
            });
          }
          notifiedNearEndDatesRef.current.add(task.id);
        }
      }
    });

    previousTasksRef.current = tasks;
  }, [tasks, user]);

  // --- Handlers ---

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const GOOGLE_SCRIPT_URL = (import.meta as any).env.VITE_GOOGLE_SCRIPT_URL || '';
    if (!GOOGLE_SCRIPT_URL && file.size > 700 * 1024) {
      alert('File is too large. Max size is 700KB. Configure a Google Script URL in Settings to allow larger files via Google Drive.');
      return;
    }

    setIsUploading(true);
    const fileName = file.name;

    let nextSerial = '';
    const numbersInName = fileName.match(/\d/g);
    if (numbersInName && numbersInName.length >= 3) {
      nextSerial = numbersInName.slice(0, 5).join('');
    } else {
      let maxSerial = 0;
      tasks.forEach(t => {
        if (t.serialNumber) {
          const num = parseInt(t.serialNumber.replace(/\D/g, ''), 10);
          if (!isNaN(num) && num > maxSerial) {
            maxSerial = num;
          }
        }
      });
      nextSerial = String(maxSerial + 1).padStart(3, '0');
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const dataUrl = event.target?.result as string;

      if (GOOGLE_SCRIPT_URL) {
        try {
          const res = await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
              filename: file.name,
              mimeType: file.type,
              base64: dataUrl
            })
          });
          const result = await res.json();
          if (result.status === 'success') {
            setFormData(prev => ({ 
              ...prev, 
              attachedFile: result.url,
              attachedFileName: fileName,
              serialNumber: nextSerial
            }));
            setIsUploading(false);
            return; // Success!
          } else {
            console.error('GS Error:', result.message);
            alert('Google Script Error: ' + result.message);
          }
        } catch (err) {
          console.error('Fetch error:', err);
          alert('Failed to connect to Google Script. Check the console.');
        }
      }

      // Fallback
      if (file.size > 700 * 1024) {
         alert("Upload failed. File too large for fallback storage.");
      } else {
        setFormData(prev => ({ 
          ...prev, 
          attachedFile: dataUrl,
          attachedFileName: fileName,
          serialNumber: nextSerial
        }));
      }
      setIsUploading(false);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const currentUserId = user?.uid;

    const taskData: any = {
      taskName: formData.taskName,
      status: formData.status,
      description: formData.description,
      statusUpdate: formData.statusUpdate,
      assignedTo: formData.assignedTo,
      waitingOn: formData.waitingOn,
      requiredAction: formData.requiredAction,
      notes: formData.notes,
      dueDate: formData.dueDate || null,
      priority: formData.priority,
      userId: currentUserId,
      teamId: appUser.teamId || 'NONE',
      updatedAt: serverTimestamp(),
    };

    if (formData.attachedFile) {
      taskData.attachedFile = formData.attachedFile;
      taskData.attachedFileName = formData.attachedFileName;
      taskData.serialNumber = formData.serialNumber;
    } else if (editingTask) {
      taskData.attachedFile = deleteField();
      taskData.attachedFileName = deleteField();
      taskData.serialNumber = deleteField();
    }

    try {
      if (editingTask) {
        await updateDoc(doc(db, 'tasks', editingTask.id), taskData);
      } else {
        await addDoc(collection(db, 'tasks'), {
          ...taskData,
          createdAt: serverTimestamp(),
        });
      }
      closeModal();
    } catch (err) {
      handleFirestoreError(err, editingTask ? OperationType.UPDATE : OperationType.CREATE, 'tasks');
      setError('Failed to save task. Check your permissions.');
    }
  };

  const handleToggleNote = async (taskId: string, noteId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const updatedNotes = (task.notes || []).map(n => 
      n.id === noteId ? { ...n, isCompleted: !n.isCompleted } : n
    );
    try {
      await updateDoc(doc(db, 'tasks', taskId), { notes: updatedNotes, updatedAt: serverTimestamp() });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'tasks');
    }
  };

  const confirmDelete = async () => {
    if (!taskToDelete) return;
    try {
      await deleteDoc(doc(db, 'tasks', taskToDelete.id));
      setTaskToDelete(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'tasks');
      setError('Failed to delete task.');
      setTaskToDelete(null);
    }
  };

  const handleDelete = (task: Task) => {
    setTaskToDelete(task);
  };

  const handleDeleteAttachment = async () => {
    if (!attachmentToDelete) return;
    try {
      await updateDoc(doc(db, 'tasks', attachmentToDelete.id), {
        attachedFile: deleteField(),
        attachedFileName: deleteField(),
        serialNumber: deleteField(),
        updatedAt: serverTimestamp()
      });
      setAttachmentToDelete(null);
    } catch (err: any) {
      console.error(err);
      alert('Error deleting attachment: ' + err.message);
    }
  };

  const openModal = (task?: Task) => {
    if (task) {
      setEditingTask(task);
      setFormData({
        taskName: task.taskName,
        status: task.status,
        description: task.description || '',
        statusUpdate: task.statusUpdate || STATUS_UPDATE_OPTIONS[0],
        assignedTo: task.assignedTo || '',
        waitingOn: task.waitingOn || '',
        requiredAction: task.requiredAction || ACTION_OPTIONS[0],
        notes: task.notes || [],
        dueDate: task.dueDate || '',
        priority: task.priority || 'Medium',
        attachedFile: task.attachedFile || '',
        attachedFileName: task.attachedFileName || '',
        serialNumber: task.serialNumber || ''
      });
    } else {
      setEditingTask(null);
      setFormData({
        taskName: '',
        status: 'Pending',
        description: '',
        statusUpdate: STATUS_UPDATE_OPTIONS[0],
        assignedTo: '',
        waitingOn: '',
        requiredAction: ACTION_OPTIONS[0],
        notes: [],
        dueDate: '',
        priority: 'Medium',
        attachedFile: '',
        attachedFileName: '',
        serialNumber: ''
      });
    }
    setNewNoteText('');
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingTask(null);
    setError(null);
  };

  const exportToExcel = () => {
    const dataToExport = tasks.map(t => ({
      'Task Name': t.taskName,
      'Priority': t.priority || 'Medium',
      'Status': t.status,
      'Assigned To': t.assignedTo || '',
      'Waiting On': t.waitingOn || '',
      'Required Action': t.requiredAction || '',
      'Description': t.description,
      'Sub-tasks': (t.notes || []).map(n => `[${n.isCompleted ? 'x' : ' '}] ${n.text}`).join('\n'),
      'Latest Update': t.statusUpdate,
      'Created At': t.createdAt?.toDate().toLocaleString(),
      'Updated At': t.updatedAt?.toDate().toLocaleString()
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tasks');
    XLSX.writeFile(wb, 'Task_Follow_Up.xlsx');
  };

  // --- Filtered Tasks ---

  const filteredTasks = useMemo(() => {
    return tasks.filter(t => {
      const assigned = t.assignedTo;
      if (currentView === 'my-assignments') {
        if (!user || !user.displayName || assigned !== user.displayName) {
          return false;
        }
      } else if (currentView === 'outstanding') {
        if (!user || !user.displayName || t.waitingOn !== user.displayName) {
          return false;
        }
      }

      const matchesSearch = t.taskName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          t.description.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === 'All' || t.status === statusFilter;
      const matchesAssignedTo = assignedToFilter === 'All' || (assigned && assigned === assignedToFilter);
      return matchesSearch && matchesStatus && matchesAssignedTo;
    });
  }, [tasks, searchQuery, statusFilter, assignedToFilter, currentView, user]);

  const uniqueAssignees = useMemo(() => {
    const list = new Set(tasks.map(t => t.assignedTo).filter(Boolean));
    return Array.from(list) as string[];
  }, [tasks]);

  // --- Render Helpers ---

  return (
    <div className="text-neutral-900 font-sans">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* View Tabs */}
        <div className="flex flex-wrap items-center gap-2 mb-8 bg-neutral-100 p-1.5 rounded-xl w-fit">
          {isSuperUser && (
            <button
              onClick={() => setCurrentView('department')}
              className={cn(
                "px-5 py-2.5 rounded-lg text-sm font-semibold transition-all",
                currentView === 'department' ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700 hover:bg-neutral-200/50 shadow-none transparent"
              )}
            >
              Department Tasks
            </button>
          )}
          <button
            onClick={() => {
              if (!user) {
                alert("Please sign in to view your assignments.");
                return;
              }
              setCurrentView('my-assignments');
            }}
            className={cn(
              "px-5 py-2.5 rounded-lg text-sm font-semibold transition-all",
              currentView === 'my-assignments' ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700 hover:bg-neutral-200/50 shadow-none transparent"
            )}
          >
            My Assignments
          </button>
          <button
            onClick={() => {
              if (!user) {
                alert("Please sign in to view your outstanding tasks.");
                return;
              }
              setCurrentView('outstanding');
            }}
            className={cn(
              "px-5 py-2.5 rounded-lg text-sm font-semibold transition-all",
              currentView === 'outstanding' ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700 hover:bg-neutral-200/50 shadow-none transparent"
            )}
          >
            Outstanding
          </button>
        </div>

        {/* Actions Bar */}
        <div className="flex flex-col md:flex-row gap-4 mb-8 items-stretch md:items-center justify-between">
          <div className="flex flex-1 gap-4 items-center">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
              <input 
                type="text" 
                placeholder="Search tasks..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-white border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900/5 transition-all"
              />
            </div>
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
              <select 
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="pl-10 pr-8 py-2 bg-white border border-neutral-200 rounded-xl text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-neutral-900/5 transition-all cursor-pointer"
              >
                <option>All</option>
                <option>Pending</option>
                <option>In Progress</option>
                <option>Done</option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 pointer-events-none" />
            </div>

            <div className="relative" style={{ display: currentView === 'department' ? 'block' : 'none' }}>
              <UserCircle2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
              <select 
                value={assignedToFilter}
                onChange={(e) => setAssignedToFilter(e.target.value)}
                className="pl-10 pr-8 py-2 bg-white border border-neutral-200 rounded-xl text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-neutral-900/5 transition-all cursor-pointer max-w-[150px] truncate"
              >
                <option value="All">All Assigned To</option>
                {uniqueAssignees.map(assignee => (
                  <option key={assignee} value={assignee}>{assignee}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 pointer-events-none" />
            </div>
          </div>

          <div className="flex gap-3">
            <button 
              onClick={exportToExcel}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-neutral-200 rounded-xl text-sm font-medium hover:bg-neutral-50 transition-all shadow-sm"
            >
              <Download className="w-4 h-4" />
              Export Excel
            </button>
            <button 
              onClick={() => openModal()}
              className="flex items-center gap-2 px-4 py-2 bg-neutral-900 text-white rounded-xl text-sm font-medium hover:bg-neutral-800 transition-all shadow-sm"
            >
              <Plus className="w-4 h-4" />
              New Task
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl flex items-center gap-3 text-red-600 text-sm">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            {error}
            <button onClick={() => setError(null)} className="ml-auto p-1 hover:bg-red-100 rounded">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Task Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <AnimatePresence mode="popLayout">
            {filteredTasks.map((task) => (
              <motion.div
                key={task.id}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                onClick={() => openModal(task)}
                className="bg-white border border-neutral-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all group cursor-pointer"
              >
                {task.attachedFile && (
                  <div className="mb-4 bg-neutral-50 rounded-xl p-3 border border-neutral-100 flex flex-col gap-3">
                    {(task.attachedFile.startsWith('data:image/') || (task.attachedFile.includes('drive.google.com/uc') && task.attachedFileName.match(/\.(jpeg|jpg|gif|png|webp|bmp|svg)$/i))) && (
                      <div 
                        className="w-full h-48 flex items-center justify-center rounded-lg overflow-hidden border border-neutral-200 bg-neutral-100 cursor-zoom-in"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFullscreenImage(task.attachedFile);
                        }}
                      >
                        <img 
                          src={getImageUrl(task.attachedFile)} 
                          alt={task.attachedFileName} 
                          className="max-w-full max-h-full object-contain mix-blend-multiply" 
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex flex-col overflow-hidden">
                        <span className="text-xs font-bold text-neutral-400 uppercase">Attached File</span>
                        <span className="text-sm font-medium text-neutral-700 truncate">{task.attachedFileName}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {task.serialNumber && (
                          <span className="px-2 py-1 bg-white border border-neutral-200 rounded text-xs font-mono text-neutral-600">
                            #{task.serialNumber}
                          </span>
                        )}
                        <a 
                          href={task.attachedFile} 
                          download={task.attachedFileName}
                          target={task.attachedFile.includes('drive.google.com') ? "_blank" : "_self"}
                          onClick={(e) => e.stopPropagation()}
                          className="p-2 bg-white border border-neutral-200 rounded-lg text-neutral-500 hover:text-blue-600 hover:border-blue-200 transition-colors"
                          title="Download File"
                        >
                          <Download className="w-4 h-4" />
                        </a>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setAttachmentToDelete(task);
                          }}
                          className="p-2 bg-white border border-neutral-200 rounded-lg text-neutral-500 hover:text-red-600 hover:border-red-200 transition-colors"
                          title="Delete Attachment"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex flex-wrap gap-2">
                    <div className={cn(
                      "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                      task.status === 'Done' ? "bg-green-50 text-green-600" :
                      task.status === 'In Progress' ? "bg-blue-50 text-blue-600" :
                      "bg-amber-50 text-amber-600"
                    )}>
                      {task.status}
                    </div>
                    {task.priority && (
                      <div className={cn(
                        "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                        task.priority === 'Urgent' ? "bg-red-100 text-red-700" :
                        task.priority === 'High' ? "bg-orange-100 text-orange-700" :
                        task.priority === 'Medium' ? "bg-blue-50 text-blue-700" :
                        "bg-neutral-100 text-neutral-600"
                      )}>
                        Priority: {task.priority}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 transition-opacity opacity-100 md:opacity-0 md:group-hover:opacity-100">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        openModal(task);
                      }}
                      className="p-1.5 text-neutral-400 hover:text-neutral-900 hover:bg-neutral-50 rounded-lg"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(task);
                      }}
                      className="p-1.5 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-0.5 bg-neutral-100 text-neutral-500 border border-neutral-200 rounded text-[10px] font-mono leading-tight">
                    {task.id.slice(0, 5).toUpperCase()}
                  </span>
                  <h3 className="text-lg font-bold line-clamp-1">{task.taskName}</h3>
                </div>
                <p className="text-neutral-500 text-sm mb-3 line-clamp-2 min-h-[2.5rem]">
                  {task.description || "No description provided."}
                </p>

                {(task.assignedTo || task.waitingOn || task.requiredAction || task.dueDate) && (
                  <div className="flex flex-col gap-2 mb-4">
                    {task.assignedTo && (
                      <div className="flex items-center gap-2 text-xs font-medium text-purple-700 bg-purple-50 px-2.5 py-1.5 rounded-lg w-fit">
                        <UserCircle2 className="w-4 h-4" />
                        Assigned to: {task.assignedTo}
                      </div>
                    )}
                    {task.waitingOn && (
                      <div className="flex items-center gap-2 text-xs font-medium text-pink-700 bg-pink-50 px-2.5 py-1.5 rounded-lg w-fit">
                        <UserCircle2 className="w-4 h-4" />
                        Waiting on: {task.waitingOn}
                      </div>
                    )}
                    {task.requiredAction && (
                      <div className="flex items-start gap-2 text-xs font-medium text-rose-700 bg-rose-50 px-2.5 py-1.5 rounded-lg w-fit">
                        <ListTodo className="w-4 h-4 shrink-0 mt-0.5" />
                        <span className="line-clamp-2">Action: {task.requiredAction}</span>
                      </div>
                    )}
                    {task.dueDate && (
                      <div className="flex items-center gap-2 text-xs font-medium text-amber-700 bg-amber-50 px-2.5 py-1.5 rounded-lg w-fit">
                        <Calendar className="w-4 h-4 shrink-0" />
                        Due: {new Date(task.dueDate).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                )}

                {task.notes && task.notes.length > 0 && (
                  <div className="mb-4 space-y-2">
                    {task.notes.map(note => (
                      <div 
                        key={note.id} 
                        className="flex items-start gap-2 group/note cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleNote(task.id, note.id);
                        }}
                      >
                        <button className="mt-0.5 text-neutral-400 group-hover/note:text-neutral-900 transition-colors">
                          {note.isCompleted ? (
                            <CheckSquare className="w-4 h-4 text-green-600" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                        <span className={cn(
                          "text-sm flex-1", 
                          note.isCompleted ? "text-neutral-400 line-through" : "text-neutral-700"
                        )}>
                          {note.text}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-3 pt-4 border-t border-neutral-100 mt-4">
                  <div className="bg-neutral-50 rounded-xl p-3 mt-2">
                    <div className="text-[10px] font-bold text-neutral-400 uppercase mb-1 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Latest Update
                    </div>
                    <p className="text-sm text-neutral-700 italic">
                      "{task.statusUpdate || "No updates yet."}"
                    </p>
                  </div>
                  <div className="flex justify-between items-center text-[10px] text-neutral-400 uppercase font-semibold pt-1">
                    <div>
                      Started: {task.createdAt?.toDate().toLocaleDateString()}
                    </div>
                    <div>
                      Updated: {task.updatedAt?.toDate().toLocaleDateString()}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {filteredTasks.length === 0 && (
            <div className="col-span-full py-20 text-center">
              <div className="w-16 h-16 bg-neutral-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Search className="w-8 h-8 text-neutral-300" />
              </div>
              <h3 className="text-lg font-medium text-neutral-900">No tasks found</h3>
              <p className="text-neutral-500">Try adjusting your search or filters.</p>
            </div>
          )}
        </div>
      </main>

      {/* Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeModal}
              className="absolute inset-0 bg-neutral-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-xl max-h-[90vh] bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden"
            >
              <div className="px-6 py-4 sm:px-8 sm:py-6 border-b border-neutral-100 flex items-center justify-between shrink-0">
                <h2 className="text-xl font-bold">{editingTask ? 'Edit Task' : 'New Task'}</h2>
                <button type="button" onClick={closeModal} className="p-2 hover:bg-neutral-100 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-6 overflow-y-auto">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="col-span-full">
                    <label className="block text-xs font-bold text-neutral-400 uppercase mb-2">Task Name</label>
                    <input 
                      required
                      type="text" 
                      value={formData.taskName}
                      onChange={(e) => setFormData({ ...formData, taskName: e.target.value })}
                      placeholder="e.g. Q1 Budget Review"
                      className="w-full px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/5"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-neutral-400 uppercase mb-2">Assigned To</label>
                    <div className="relative">
                      <select 
                        value={formData.assignedTo}
                        onChange={(e) => setFormData({ ...formData, assignedTo: e.target.value })}
                        className="w-full px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/5 appearance-none"
                      >
                        <option value="">None / Unassigned</option>
                        {projectUsers.filter(u => u.status === 'Approved').map(u => (
                          <option key={u.id} value={u.displayName}>{u.displayName}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 pointer-events-none" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-neutral-400 uppercase mb-2">Waiting On</label>
                    <div className="relative">
                      <select 
                        value={formData.waitingOn}
                        onChange={(e) => setFormData({ ...formData, waitingOn: e.target.value })}
                        className="w-full px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/5 appearance-none"
                      >
                        <option value="">None</option>
                        {projectUsers.filter(u => u.status === 'Approved').map(u => (
                          <option key={u.id} value={u.displayName}>{u.displayName}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 pointer-events-none" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-neutral-400 uppercase mb-2">Required Action</label>
                    <div className="relative">
                      <select 
                        value={formData.requiredAction}
                        onChange={(e) => setFormData({ ...formData, requiredAction: e.target.value })}
                        className="w-full px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/5 appearance-none"
                      >
                        {ACTION_OPTIONS.map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 pointer-events-none" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-neutral-400 uppercase mb-2">Due Date</label>
                    <input 
                      type="date" 
                      value={formData.dueDate}
                      onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                      className="w-full px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/5 appearance-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-neutral-400 uppercase mb-2">Priority</label>
                    <div className="relative">
                      <select 
                        value={formData.priority}
                        onChange={(e) => setFormData({ ...formData, priority: e.target.value as NonNullable<Task['priority']> })}
                        className="w-full px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/5 appearance-none"
                      >
                        <option value="Low">Low</option>
                        <option value="Medium">Medium</option>
                        <option value="High">High</option>
                        <option value="Urgent">Urgent</option>
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 pointer-events-none" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-neutral-400 uppercase mb-2">Status</label>
                    <div className="relative">
                      <select 
                        value={formData.status}
                        onChange={(e) => setFormData({ ...formData, status: e.target.value as Task['status'] })}
                        className="w-full px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/5 appearance-none"
                      >
                        <option>Pending</option>
                        <option>In Progress</option>
                        <option>Done</option>
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 pointer-events-none" />
                    </div>
                  </div>

                  <div className="col-span-full">
                    <label className="block text-xs font-bold text-neutral-400 uppercase mb-2">Attached File & Serial</label>
                    <div className="flex flex-col gap-4">
                      {formData.attachedFile && (
                        <div className="relative p-4 rounded-xl border border-neutral-200 bg-neutral-50 shrink-0">
                          <div className="text-sm font-medium text-neutral-800 line-clamp-1">{formData.attachedFileName}</div>
                          <button 
                            type="button" 
                            onClick={() => setFormData({ ...formData, attachedFile: '', attachedFileName: '', serialNumber: '' })}
                            className="absolute top-2 right-2 text-neutral-400 hover:text-red-500 transition-colors"
                          >
                            <X className="w-5 h-5" />
                          </button>
                        </div>
                      )}
                      
                      <div className="flex items-center gap-4">
                        <label className="flex items-center justify-center gap-2 px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl cursor-pointer hover:bg-neutral-100 transition-colors w-full sm:w-auto text-sm font-medium">
                          {isUploading ? (
                            <>
                              <div className="w-5 h-5 border-2 border-neutral-400 border-t-neutral-800 rounded-full animate-spin" />
                              <span>Uploading...</span>
                            </>
                          ) : (
                            <>
                              <FileText className="w-5 h-5 text-neutral-400" />
                              <span>{formData.attachedFile ? 'Replace File' : 'Attach File'}</span>
                            </>
                          )}
                          <input 
                            type="file" 
                            accept="*/*"
                            disabled={isUploading}
                            onChange={handleFileUpload}
                            className="hidden"
                          />
                        </label>
                        
                        {formData.attachedFile && (
                          <div className="flex items-center gap-3 ml-auto">
                            <span className="text-sm font-bold text-neutral-400 uppercase hidden sm:inline">Serial No.</span>
                            <input 
                              type="text" 
                              value={formData.serialNumber}
                              onChange={(e) => setFormData({ ...formData, serialNumber: e.target.value })}
                              className="px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900/5 text-sm font-mono w-24 text-center"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="col-span-full">
                    <label className="block text-xs font-bold text-neutral-400 uppercase mb-2">Description</label>
                    <textarea 
                      rows={3}
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="What needs to be done?"
                      className="w-full px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/5 resize-none"
                    />
                  </div>

                  <div className="col-span-full">
                    <label className="block text-xs font-bold text-neutral-400 uppercase mb-2">Sub-tasks / Notes</label>
                    <div className="space-y-2 mb-3">
                      {formData.notes.map((note) => (
                        <div key={note.id} className="flex items-center gap-2 bg-neutral-50 px-3 py-2 rounded-lg border border-neutral-200">
                          <button
                            type="button"
                            onClick={() => {
                              const updated = formData.notes.map(n => n.id === note.id ? { ...n, isCompleted: !n.isCompleted } : n);
                              setFormData({ ...formData, notes: updated });
                            }}
                          >
                            {note.isCompleted ? <CheckSquare className="w-4 h-4 text-green-600" /> : <Square className="w-4 h-4 text-neutral-400" />}
                          </button>
                          <span className={cn("text-sm flex-1", note.isCompleted && "line-through text-neutral-400")}>{note.text}</span>
                          <button 
                            type="button" 
                            onClick={() => setFormData({ ...formData, notes: formData.notes.filter(n => n.id !== note.id) })}
                            className="text-neutral-400 hover:text-red-600"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input 
                        type="text"
                        value={newNoteText}
                        onChange={e => setNewNoteText(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (!newNoteText.trim()) return;
                            setFormData({
                              ...formData,
                              notes: [...(formData.notes || []), { id: Date.now().toString(), text: newNoteText.trim(), isCompleted: false }]
                            });
                            setNewNoteText('');
                          }
                        }}
                        placeholder="Add a sub-task or note..."
                        className="flex-1 px-4 py-2 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/5 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (!newNoteText.trim()) return;
                          setFormData({
                            ...formData,
                            notes: [...(formData.notes || []), { id: Date.now().toString(), text: newNoteText.trim(), isCompleted: false }]
                          });
                          setNewNoteText('');
                        }}
                        className="px-3 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-xl flex items-center justify-center transition-colors"
                      >
                        <PlusCircle className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  <div className="col-span-full">
                    <label className="block text-xs font-bold text-neutral-400 uppercase mb-2">Latest Status Update</label>
                    <div className="relative">
                      <select 
                        value={formData.statusUpdate}
                        onChange={(e) => setFormData({ ...formData, statusUpdate: e.target.value })}
                        className="w-full px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/5 appearance-none"
                      >
                        {STATUS_UPDATE_OPTIONS.map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400 pointer-events-none" />
                    </div>
                  </div>
                </div>

                <div className="pt-4 flex gap-3">
                  <button 
                    type="button"
                    onClick={closeModal}
                    className="flex-1 px-6 py-3 bg-neutral-100 text-neutral-600 rounded-xl font-medium hover:bg-neutral-200 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 px-6 py-3 bg-neutral-900 text-white rounded-xl font-medium hover:bg-neutral-800 transition-all shadow-lg shadow-neutral-900/10"
                  >
                    {editingTask ? 'Update Task' : 'Create Task'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {attachmentToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden"
            >
              <div className="p-6">
                <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-6">
                  <Trash2 className="w-6 h-6 text-red-600" />
                </div>
                <h3 className="text-xl font-bold text-neutral-900 mb-2">Delete Attachment?</h3>
                <p className="text-neutral-500 mb-8">
                  Are you sure you want to delete the attached file "{attachmentToDelete.attachedFileName}"? This action cannot be undone.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setAttachmentToDelete(null)}
                    className="flex-1 px-4 py-2 bg-neutral-100 text-neutral-700 font-medium rounded-xl hover:bg-neutral-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteAttachment}
                    className="flex-1 px-4 py-2 bg-red-600 text-white font-medium rounded-xl hover:bg-red-700 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {taskToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 backdrop-blur-sm p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl p-6 sm:p-8 max-w-sm w-full shadow-2xl relative"
            >
              <h3 className="text-xl font-bold mb-3 text-neutral-900">Delete Task?</h3>
              <p className="text-neutral-500 mb-6 font-medium">This action cannot be undone. Are you sure you want to delete this task?</p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setTaskToDelete(null)}
                  className="flex-1 py-3 px-4 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-xl font-medium transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmDelete}
                  className="flex-1 py-3 px-4 bg-red-600 hover:bg-red-700 text-white rounded-xl font-medium transition-colors shadow-lg shadow-red-600/20"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {fullscreenImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-4"
            onClick={() => setFullscreenImage(null)}
          >
            <button 
              className="absolute top-4 right-4 p-2 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded-full transition-colors"
              onClick={() => setFullscreenImage(null)}
            >
              <X className="w-6 h-6" />
            </button>
            <img
              src={getImageUrl(fullscreenImage)}
              alt="Fullscreen view"
              className="max-w-[95vw] max-h-[95vh] object-contain"
              referrerPolicy="no-referrer"
              onClick={(e) => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

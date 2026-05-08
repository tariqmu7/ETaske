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
  deleteField
} from 'firebase/firestore';
import { db, auth } from './lib/firebase';
import { AppUser, FollowUp, FOLLOWUP_STATUS_OPTIONS, OperationType, FirestoreErrorInfo } from './types';
import { 
  Plus, 
  Trash2, 
  Edit2, 
  Search, 
  Filter,
  CheckCircle2,
  Clock,
  X,
  FileText,
  AlertCircle,
  Download,
  ChevronDown,
  Check,
  ChevronLeft
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';
import { User } from 'firebase/auth';

function SearchableCombobox({
  value,
  onChange,
  options,
  placeholder,
  groups,
}: {
  value: string;
  onChange: (val: string) => void;
  options?: string[];
  placeholder: string;
  groups?: { label: string; options: string[] }[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isOpen) setSearch(value);
  }, [isOpen, value]);

  const normalizedSearch = search.trim().toLowerCase();
  let showAdd = false;

  const renderOptions = () => {
    if (groups) {
      let hasExactMatch = false;
      const elements = groups.map(group => {
        const filtered = group.options.filter(opt => opt.toLowerCase().includes(normalizedSearch));
        if (group.options.some(opt => opt.toLowerCase() === normalizedSearch)) hasExactMatch = true;
        
        if (filtered.length === 0) return null;
        return (
          <div key={group.label} className="py-2">
            <div className="px-4 py-1.5 text-xs font-bold text-neutral-400 uppercase tracking-wider bg-neutral-50/50 border-y border-neutral-100">{group.label}</div>
            {filtered.map(opt => (
              <div 
                key={opt}
                onClick={() => { onChange(opt); setIsOpen(false); setSearch(opt); }}
                className="px-4 py-2 hover:bg-neutral-100 cursor-pointer text-sm flex items-center justify-between group/opt"
              >
                <span>{opt}</span>
                {value === opt && <Check className="w-4 h-4 text-blue-600" />}
              </div>
            ))}
          </div>
        );
      });
      showAdd = normalizedSearch !== '' && !hasExactMatch;
      return elements;
    } else if (options) {
      const filtered = options.filter(opt => opt.toLowerCase().includes(normalizedSearch));
      const hasExactMatch = options.some(opt => opt.toLowerCase() === normalizedSearch);
      showAdd = normalizedSearch !== '' && !hasExactMatch;

      return (
        <div className="py-2">
          {filtered.length > 0 ? filtered.map(opt => (
            <div 
              key={opt}
              onClick={() => { onChange(opt); setIsOpen(false); setSearch(opt); }}
              className="px-4 py-2 hover:bg-neutral-100 cursor-pointer text-sm flex items-center justify-between group/opt"
            >
              <span>{opt}</span>
              {value === opt && <Check className="w-4 h-4 text-blue-600" />}
            </div>
          )) : (
            !showAdd && <div className="px-4 py-3 text-sm text-neutral-500 text-center">No options found.</div>
          )}
        </div>
      )
    }
  };

  const renderedOpts = renderOptions();

  return (
    <div className="relative w-full" ref={wrapperRef}>
      <div 
        className="flex items-center w-full px-4 py-2 bg-neutral-50 border border-neutral-200 rounded-xl focus-within:ring-2 focus-within:ring-neutral-900/5 focus-within:bg-white transition-colors cursor-text min-h-[44px]"
        onClick={() => { setIsOpen(true); }}
      >
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setIsOpen(true);
            onChange(e.target.value);
          }}
          onFocus={() => {
            setIsOpen(true);
            setSearch(value); 
          }}
          placeholder={placeholder}
          className="w-full bg-transparent focus:outline-none text-sm text-neutral-800 placeholder:text-neutral-400"
        />
        {value && !isOpen && (
          <X 
            className="w-4 h-4 text-neutral-400 hover:text-neutral-600 shrink-0 ml-2 cursor-pointer" 
            onClick={(e) => { e.stopPropagation(); onChange(''); setSearch(''); setIsOpen(true); }} 
          />
        )}
        <ChevronDown 
          className={cn("w-4 h-4 text-neutral-400 shrink-0 ml-2 transition-transform cursor-pointer hover:text-neutral-600", isOpen && "rotate-180")}
          onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }} 
        />
      </div>
      
      <AnimatePresence>
        {isOpen && (
          <motion.div 
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 w-full mt-2 bg-white border border-neutral-200 rounded-xl shadow-xl max-h-64 overflow-y-auto"
          >
            {renderedOpts}
            
            {showAdd && (
              <div 
                onClick={() => { onChange(search.trim()); setIsOpen(false); }}
                className="px-4 py-3 hover:bg-blue-50 cursor-pointer text-sm font-medium text-blue-600 flex items-center gap-2 border-t border-neutral-100 bg-neutral-50/50 transition-colors sticky bottom-0"
              >
                <div className="w-6 h-6 rounded-md bg-blue-100 flex items-center justify-center shrink-0">
                  <Plus className="w-4 h-4 text-blue-700" /> 
                </div>
                Create "{search.trim()}"
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
}

interface Props {
  user: User;
  appUser: AppUser;
  projectUsers: AppUser[];
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

export default function FollowUpDashboard({ user, appUser, projectUsers }: Props) {
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<FollowUp | null>(null);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [assignedToFilter, setAssignedToFilter] = useState<string>('All');
  const [error, setError] = useState<string | null>(null);
  const [itemToDelete, setItemToDelete] = useState<FollowUp | null>(null);
  const [attachmentToDelete, setAttachmentToDelete] = useState<FollowUp | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedDepartment, setSelectedDepartment] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    dateIssued: new Date().toISOString().split('T')[0],
    subject: '',
    sentFrom: '',
    department: '',
    subCategory: '',
    assignedPersonnel: '',
    endDate: '',
    actionRequired: '',
    actionTakenSoFar: '',
    status: 'Pending' as FollowUp['status'],
    attachedFile: '',
    attachedFileName: '',
    serialNumber: ''
  });

  useEffect(() => {
    let q;
    if (appUser.role === 'Admin') {
      q = query(collection(db, 'followUps'), orderBy('createdAt', 'desc'));
    } else {
      q = query(
        collection(db, 'followUps'),
        where('teamId', '==', appUser.teamId || 'NONE'),
        orderBy('createdAt', 'desc')
      );
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as FollowUp[];
      setFollowUps(items);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, 'followUps');
      setError('Failed to load documents. Please check your permissions.');
    });

    return () => unsubscribe();
  }, [user, appUser]);

  // Notifications logic
  const previousFollowUpsRef = useRef<FollowUp[]>([]);
  const notifiedNearEndDatesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    if (!user) return;

    const previousFollowUpsMap = new Map<string, FollowUp>(previousFollowUpsRef.current.map(t => [t.id, t]));
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    followUps.forEach(item => {
      // 1. New Assignment (Only check if previousFollowUpsRef is NOT empty, to avoid spam on initial load)
      if (previousFollowUpsRef.current.length > 0) {
        const prevItem = previousFollowUpsMap.get(item.id);
        const isNewlyAssigned = item.assignedPersonnel === user.displayName && prevItem?.assignedPersonnel !== user.displayName;

        if ('Notification' in window && Notification.permission === 'granted') {
          if (isNewlyAssigned) {
            new Notification('New Follow-up Assigned', {
              body: `You have been assigned to follow up on: ${item.subject}`
            });
          }
        }
      }

      // 2. Nearing End Date (Check always, including initial load, but keep track so we only notify once per session)
      if (item.assignedPersonnel === user.displayName && item.endDate && item.status !== 'Closed' && item.status !== 'Approved') {
        const endDateVal = new Date(item.endDate);
        endDateVal.setHours(0, 0, 0, 0);
        const diffTime = endDateVal.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays >= 0 && diffDays <= 3 && !notifiedNearEndDatesRef.current.has(item.id)) {
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('Follow-up Nearing End Date', {
              body: `"${item.subject}" is due in ${diffDays} day(s).`
            });
          }
          notifiedNearEndDatesRef.current.add(item.id);
        }
      }
    });

    previousFollowUpsRef.current = followUps;
  }, [followUps, user]);

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
      followUps.forEach(t => {
        if (t.serialNumber) {
          const num = parseInt(t.serialNumber, 10);
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

  const uniqueSentFrom = useMemo(() => {
    const list = new Set(followUps.map(t => t.sentFrom || t.description).filter(Boolean));
    return Array.from(list) as string[];
  }, [followUps]);

  const uniqueSubCategories = useMemo(() => {
    const list = new Set(followUps.map(t => t.subCategory || t.epromProjectName).filter(Boolean));
    return Array.from(list) as string[];
  }, [followUps]);

  const filteredItems = useMemo(() => {
    return followUps.filter(t => {
      if (searchQuery && 
          !t.subject.toLowerCase().includes(searchQuery.toLowerCase()) && 
          !(t.sentFrom || t.description || '').toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      if (statusFilter !== 'All' && t.status !== statusFilter) {
        return false;
      }
      if (assignedToFilter !== 'All' && t.assignedPersonnel !== assignedToFilter) {
        return false;
      }
      return true;
    });
  }, [followUps, searchQuery, statusFilter, assignedToFilter]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const currentUserId = user?.uid;
    const taskData: any = {
      dateIssued: formData.dateIssued,
      subject: formData.subject,
      sentFrom: formData.sentFrom,
      department: formData.department,
      subCategory: formData.subCategory,
      assignedPersonnel: formData.assignedPersonnel,
      endDate: formData.endDate,
      actionRequired: formData.actionRequired,
      actionTakenSoFar: formData.actionTakenSoFar,
      status: formData.status,
      userId: currentUserId,
      teamId: appUser.teamId || 'NONE',
      updatedAt: serverTimestamp(),
    };

    if (formData.attachedFile) {
      taskData.attachedFile = formData.attachedFile;
      taskData.attachedFileName = formData.attachedFileName;
      taskData.serialNumber = formData.serialNumber;
    } else if (editingItem) {
      taskData.attachedFile = deleteField();
      taskData.attachedFileName = deleteField();
      taskData.serialNumber = deleteField();
    }

    try {
      if (editingItem) {
        await updateDoc(doc(db, 'followUps', editingItem.id), taskData);
      } else {
        await addDoc(collection(db, 'followUps'), {
          ...taskData,
          createdAt: serverTimestamp(),
        });
      }
      closeModal();
    } catch (err) {
      console.error(err);
      handleFirestoreError(err, editingItem ? OperationType.UPDATE : OperationType.CREATE, 'followUps');
      alert('Error saving document.');
    }
  };

  const handleDelete = (item: FollowUp) => {
    setItemToDelete(item);
  };

  const handleDeleteAttachment = async () => {
    if (!attachmentToDelete) return;
    try {
      await updateDoc(doc(db, 'followUps', attachmentToDelete.id), {
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

  const confirmDelete = async () => {
    if (!itemToDelete) return;
    try {
      await deleteDoc(doc(db, 'followUps', itemToDelete.id));
      setItemToDelete(null);
    } catch (err) {
      console.error(err);
      handleFirestoreError(err, OperationType.DELETE, `followUps/${itemToDelete.id}`);
      alert('Error deleting document. You may not have permission.');
    }
  };

  const openModal = (item?: FollowUp) => {
    if (item) {
      setEditingItem(item);
      setFormData({
        dateIssued: item.dateIssued,
        subject: item.subject,
        sentFrom: item.sentFrom || item.description || '',
        department: item.department || '',
        subCategory: item.subCategory || item.epromProjectName || '',
        assignedPersonnel: item.assignedPersonnel,
        endDate: item.endDate || '',
        actionRequired: item.actionRequired || '',
        actionTakenSoFar: item.actionTakenSoFar || '',
        status: item.status,
        attachedFile: item.attachedFile || '',
        attachedFileName: item.attachedFileName || '',
        serialNumber: item.serialNumber || ''
      });
    } else {
      setEditingItem(null);
      setFormData({
        dateIssued: new Date().toISOString().split('T')[0],
        subject: '',
        sentFrom: '',
        department: '',
        subCategory: '',
        assignedPersonnel: '',
        endDate: '',
        actionRequired: '',
        actionTakenSoFar: '',
        status: 'Pending',
        attachedFile: '',
        attachedFileName: '',
        serialNumber: ''
      });
    }
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingItem(null);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Closed': return 'bg-neutral-100 text-neutral-600 border-neutral-200';
      case 'Approved': return 'bg-green-100 text-green-700 border-green-200';
      case 'Returned': return 'bg-red-100 text-red-700 border-red-200';
      case 'Pending':
      default:
        return 'bg-amber-100 text-amber-700 border-amber-200';
    }
  };

  const statusOptions = [...FOLLOWUP_STATUS_OPTIONS];

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-xl flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5" />
            <p className="text-sm font-medium">{error}</p>
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
            <input 
              type="text"
              placeholder="Search documents..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 bg-white border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900/5 transition-all w-full sm:w-64"
            />
          </div>
          
          <div className="flex gap-2">
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
              <select 
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="pl-10 pr-8 py-2 bg-white border border-neutral-200 rounded-xl text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-neutral-900/5 transition-all cursor-pointer"
              >
                <option value="All">All Statuses</option>
                {statusOptions.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>

            <div className="relative">
              <select 
                value={assignedToFilter}
                onChange={(e) => setAssignedToFilter(e.target.value)}
                className="pl-4 pr-8 py-2 bg-white border border-neutral-200 rounded-xl text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-neutral-900/5 transition-all cursor-pointer max-w-[150px] truncate"
              >
                <option value="All">All Assignees</option>
                {projectUsers.map(u => (
                  <option key={u.id} value={u.displayName}>{u.displayName}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <button 
          onClick={() => openModal()}
          className="bg-neutral-900 hover:bg-neutral-800 text-white px-5 py-2.5 rounded-xl font-medium transition-all shadow-lg shadow-neutral-900/20 flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          <span>New Follow-up</span>
        </button>
      </div>

      <div className="space-y-12">
        {(() => {
          if (filteredItems.length === 0) return null;

          const groupedByDepartment = filteredItems.reduce((acc, item) => {
            let groupName = item.department || 'Uncategorized';
            const cat = item.subCategory || item.epromProjectName;
            if (item.department && cat) {
              groupName = `${item.department} - ${cat}`;
            }
            if (!acc[groupName]) acc[groupName] = [];
            acc[groupName].push(item);
            return acc;
          }, {} as Record<string, FollowUp[]>);

          if (!selectedDepartment) {
            // Show Departments Grid
            return (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {(Object.entries(groupedByDepartment) as [string, FollowUp[]][]).sort(([a], [b]) => a.localeCompare(b)).map(([dept, items]) => (
                  <motion.div 
                    key={dept}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    onClick={() => setSelectedDepartment(dept)}
                    className="bg-white border border-neutral-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all cursor-pointer group flex flex-col items-center justify-center text-center gap-4 min-h-[200px]"
                  >
                    <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                      <FileText className="w-8 h-8" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-neutral-900 line-clamp-2">{dept}</h3>
                      <p className="text-neutral-500 mt-1">{items.length} Follow-ups</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            );
          }

          const departmentItems = groupedByDepartment[selectedDepartment] || [];

          // Group by assignedPersonnel
          const groupedByAssignee = departmentItems.reduce((acc, item) => {
            const assignee = item.assignedPersonnel || 'Unassigned';
            if (!acc[assignee]) acc[assignee] = [];
            acc[assignee].push(item);
            return acc;
          }, {} as Record<string, FollowUp[]>);

          return (
            <div className="space-y-8">
              <div className="flex flex-col gap-4">
                <button 
                  onClick={() => setSelectedDepartment(null)}
                  className="flex items-center gap-2 text-sm font-medium text-neutral-500 hover:text-neutral-900 transition-colors w-max"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Back to Departments
                </button>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                  <h2 className="text-2xl font-bold text-neutral-900">{selectedDepartment}</h2>
                  <span className="text-sm font-medium text-neutral-500 bg-neutral-100 px-3 py-1 rounded-full">{departmentItems.length} items</span>
                </div>
              </div>

              {(Object.entries(groupedByAssignee) as [string, FollowUp[]][]).sort(([a], [b]) => a.localeCompare(b)).map(([assignee, items]) => (
                <div key={assignee} className="space-y-4">
                  <h3 className="text-lg font-bold text-neutral-800 flex items-center gap-2 border-b border-neutral-200 pb-2">
                    {assignee} <span className="text-sm font-normal text-neutral-500 bg-neutral-100 px-2 py-0.5 rounded-full">{items.length}</span>
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    <AnimatePresence>
                      {items.map(item => (
                        <motion.div 
                          key={item.id}
                          layout
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          onClick={() => openModal(item)}
                          className="bg-white border border-neutral-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all group relative flex flex-col h-full cursor-pointer"
                        >
                          <div className="flex-1">
                            {item.attachedFile && (
                              <div className="mb-4 bg-neutral-50 rounded-xl p-3 border border-neutral-100 flex flex-col gap-3">
                                {(item.attachedFile.startsWith('data:image/') || (item.attachedFile.includes('drive.google.com/uc') && item.attachedFileName?.match(/\.(jpeg|jpg|gif|png|webp|bmp|svg)$/i))) && (
                                  <div 
                                    className="w-full h-48 flex items-center justify-center rounded-lg overflow-hidden border border-neutral-200 bg-neutral-100 cursor-zoom-in"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setFullscreenImage(item.attachedFile);
                                    }}
                                  >
                                    <img 
                                      src={getImageUrl(item.attachedFile)} 
                                      alt={item.attachedFileName} 
                                      className="max-w-full max-h-full object-contain mix-blend-multiply" 
                                      referrerPolicy="no-referrer"
                                    />
                                  </div>
                                )}
                                <div className="flex items-center justify-between gap-3">
                                  <div className="flex flex-col overflow-hidden">
                                    <span className="text-xs font-bold text-neutral-400 uppercase">Attached File</span>
                                    <span className="text-sm font-medium text-neutral-700 truncate">{item.attachedFileName}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {item.serialNumber && (
                                      <span className="px-2 py-1 bg-white border border-neutral-200 rounded text-xs font-mono text-neutral-600">
                                        #{item.serialNumber}
                                      </span>
                                    )}
                                    <a 
                                      href={item.attachedFile} 
                                      download={item.attachedFileName}
                                      target={item.attachedFile.includes('drive.google.com') ? "_blank" : "_self"}
                                      onClick={(e) => e.stopPropagation()}
                                      className="p-2 bg-white border border-neutral-200 rounded-lg text-neutral-500 hover:text-blue-600 hover:border-blue-200 transition-colors shrink-0"
                                      title="Download File"
                                    >
                                      <Download className="w-4 h-4" />
                                    </a>
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setAttachmentToDelete(item);
                                      }}
                                      className="p-2 bg-white border border-neutral-200 rounded-lg text-neutral-500 hover:text-red-600 hover:border-red-200 transition-colors shrink-0"
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
                              <div className={cn("px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider border", getStatusColor(item.status))}>
                                {item.status}
                              </div>
                            </div>
                            <div className="flex gap-1 transition-opacity opacity-100 md:opacity-0 md:group-hover:opacity-100">
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openModal(item);
                                }}
                                className="p-1.5 text-neutral-400 hover:text-neutral-900 hover:bg-neutral-50 rounded-lg"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDelete(item);
                                }}
                                className="p-1.5 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 mb-2">
                            <span className="px-2 py-0.5 bg-neutral-100 text-neutral-500 border border-neutral-200 rounded text-[10px] font-mono leading-tight">
                              {item.id.slice(0, 5).toUpperCase()}
                            </span>
                            <h3 className="text-lg font-bold line-clamp-1" title={item.subject}>{item.subject}</h3>
                          </div>
                          <p className="text-neutral-500 text-sm mb-3 line-clamp-2 min-h-[2.5rem]">
                            {(item.sentFrom || item.description) ? (
                              <>
                                <span className="font-semibold text-neutral-600">Sent From:</span> {item.sentFrom || item.description}
                              </>
                            ) : (
                              "No sender info."
                            )}
                          </p>
                          </div>

                          <div className="bg-neutral-50 rounded-xl p-3 mt-4 space-y-2">
                            <div className="flex justify-between items-center text-[10px] font-bold text-neutral-400 uppercase">
                              <span>Assigned Personnel</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="w-5 h-5 rounded-full bg-neutral-200 flex items-center justify-center text-[10px] text-neutral-600 font-bold">
                                {item.assignedPersonnel[0] || '?'}
                              </div>
                              <span className="text-sm font-medium text-neutral-700">{item.assignedPersonnel || 'Unassigned'}</span>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2 mt-2">
                            <div className="bg-neutral-50 rounded-xl p-3">
                              <div className="text-[10px] font-bold text-neutral-400 uppercase mb-1">Issued</div>
                              <div className="text-xs font-medium text-neutral-700">{new Date(item.dateIssued).toLocaleDateString()}</div>
                            </div>
                            {item.endDate && (
                              <div className="bg-neutral-50 rounded-xl p-3">
                                <div className="text-[10px] font-bold text-neutral-400 uppercase mb-1">End Date</div>
                                <div className="text-xs font-medium text-neutral-700">{new Date(item.endDate).toLocaleDateString()}</div>
                              </div>
                            )}
                          </div>

                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </div>

      {filteredItems.length === 0 && (
        <div className="text-center py-20 bg-white border border-neutral-200 rounded-3xl border-dashed">
          <FileText className="w-12 h-12 text-neutral-300 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-neutral-900 mb-1">No documents found</h3>
          <p className="text-neutral-500">Create a new follow-up to get started.</p>
        </div>
      )}

      {/* Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-sm" onClick={closeModal} />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 0.95, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl max-h-[90vh] bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden"
            >
              <div className="px-6 py-4 sm:px-8 sm:py-6 border-b border-neutral-100 flex items-center justify-between shrink-0">
                <h2 className="text-xl font-bold">{editingItem ? 'Edit Follow-up' : 'New Follow-up'}</h2>
                <button type="button" onClick={closeModal} className="p-2 hover:bg-neutral-100 rounded-full transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-6 overflow-y-auto">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="col-span-full">
                    <label className="block text-xs font-bold text-neutral-400 uppercase mb-2">Subject</label>
                    <input 
                      required
                      type="text" 
                      value={formData.subject}
                      onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                      placeholder="e.g. Q1 Equipment Invoice"
                      className="w-full px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/5"
                    />
                  </div>

                  <div className="col-span-full grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-xs font-bold text-neutral-400 uppercase mb-2">Sent From</label>
                      <SearchableCombobox 
                        value={formData.sentFrom || ''}
                        onChange={(val) => setFormData({ ...formData, sentFrom: val })}
                        options={uniqueSentFrom}
                        placeholder="Search or add sender..."
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-neutral-400 uppercase mb-2">Department</label>
                      <SearchableCombobox 
                        value={formData.department || ''}
                        onChange={(val) => setFormData({ ...formData, department: val, subCategory: '' })}
                        options={['HQ', 'External', 'EPROM Project', ...Array.from(new Set(followUps.map(f => f.department).filter(d => Boolean(d) && d !== 'HQ' && d !== 'External' && d !== 'EPROM Project'))) as string[]]}
                        placeholder="Search or add department..."
                      />
                    </div>

                      <div className="col-span-full">
                        <label className="block text-xs font-bold text-neutral-400 uppercase mb-2">Subcategory</label>
                        <SearchableCombobox 
                          value={formData.subCategory || ''}
                          onChange={(val) => setFormData({ ...formData, subCategory: val })}
                          options={uniqueSubCategories}
                          placeholder="Search or add subcategory..."
                        />
                      </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-neutral-400 uppercase mb-2">Assigned Personnel</label>
                    <div className="relative">
                      <select 
                        value={formData.assignedPersonnel}
                        onChange={(e) => setFormData({ ...formData, assignedPersonnel: e.target.value })}
                        className="w-full px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl appearance-none focus:outline-none focus:ring-2 focus:ring-neutral-900/5"
                      >
                        <option value="" disabled>Select Assignee</option>
                        {projectUsers.map(u => (
                          <option key={u.id} value={u.displayName}>{u.displayName}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-neutral-400 uppercase mb-2">Status</label>
                    <div className="relative">
                      <select 
                        value={formData.status}
                        onChange={(e) => setFormData({ ...formData, status: e.target.value as FollowUp['status'] })}
                        className="w-full px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl appearance-none focus:outline-none focus:ring-2 focus:ring-neutral-900/5"
                      >
                        {statusOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-neutral-400 uppercase mb-2">Date Issued</label>
                    <input 
                      required
                      type="date" 
                      value={formData.dateIssued}
                      onChange={(e) => setFormData({ ...formData, dateIssued: e.target.value })}
                      className="w-full px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/5"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-neutral-400 uppercase mb-2">End Date (Optional)</label>
                    <input 
                      type="date" 
                      value={formData.endDate}
                      onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                      className="w-full px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/5"
                    />
                  </div>
                  
                  <div className="col-span-full">
                    <label className="block text-xs font-bold text-neutral-400 uppercase mb-2">Action Required</label>
                    <textarea 
                      value={formData.actionRequired}
                      onChange={(e) => setFormData({ ...formData, actionRequired: e.target.value })}
                      placeholder="What needs to be done?"
                      rows={2}
                      className="w-full px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/5 resize-none"
                    />
                  </div>

                  <div className="col-span-full">
                    <label className="block text-xs font-bold text-neutral-400 uppercase mb-2">Action Taken So Far</label>
                    <textarea 
                      value={formData.actionTakenSoFar}
                      onChange={(e) => setFormData({ ...formData, actionTakenSoFar: e.target.value })}
                      placeholder="What has been done already?"
                      rows={2}
                      className="w-full px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-neutral-900/5 resize-none"
                    />
                  </div>

                  <div className="col-span-full">
                    <label className="block text-xs font-bold text-neutral-400 uppercase mb-2">Attached File</label>
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
                              maxLength={5}
                              value={formData.serialNumber}
                              onChange={(e) => {
                                const val = e.target.value.replace(/\D/g, '').slice(0, 5);
                                setFormData({ ...formData, serialNumber: val });
                              }}
                              className="px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-neutral-900/5 text-sm font-mono w-24 text-center"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                </div>

                <div className="pt-6 border-t border-neutral-100 flex gap-3">
                  <button 
                    type="button" 
                    onClick={closeModal}
                    className="flex-1 px-6 py-3 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 font-medium rounded-xl transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit" 
                    className="flex-1 px-6 py-3 bg-neutral-900 hover:bg-neutral-800 text-white font-medium rounded-xl transition-colors shadow-lg shadow-neutral-900/20"
                  >
                    {editingItem ? 'Save Changes' : 'Create Follow-up'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {attachmentToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-sm" onClick={() => setAttachmentToDelete(null)} />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden z-10"
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
        {itemToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-neutral-900/40 backdrop-blur-sm" onClick={() => setItemToDelete(null)} />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative bg-white rounded-3xl p-6 sm:p-8 max-w-sm w-full shadow-2xl text-center"
            >
              <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <Trash2 className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold mb-2">Delete Follow-up?</h3>
              <p className="text-neutral-500 mb-8">This action cannot be undone. Are you sure you want to delete this document follow-up?</p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setItemToDelete(null)}
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

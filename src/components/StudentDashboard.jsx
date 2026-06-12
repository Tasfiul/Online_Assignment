import { useCallback, useEffect, useState } from 'react';
import { db } from '../firebase';
import { 
  collection, 
  getDocs, 
  addDoc, 
  doc, 
  updateDoc, 
  deleteDoc,
  serverTimestamp,
  arrayUnion
} from 'firebase/firestore';
import { 
  Plus, 
  BookOpen, 
  UploadCloud, 
  XCircle, 
  MessageSquare,
  FileText,
  Users,
  LogOut,
  ChevronLeft,
  X,
  Clock
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { parseDescriptionLinks, validateFileType, formatDate } from '../utils/helpers';

export default function StudentDashboard({ onOpenChat }) {
  const { currentUser } = useAuth();
  
  // Data State
  const [groups, setGroups] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [allGroups, setAllGroups] = useState([]); // All groups for browse / join
  const [allUsers, setAllUsers] = useState({});
  
  // Navigation & Selection States
  const [activeGroupDetail, setActiveGroupDetailRaw] = useState(null);
  const setActiveGroupDetail = (group) => {
    if (group) {
      sessionStorage.setItem('student_activeGroupId', group.groupId);
    } else {
      sessionStorage.removeItem('student_activeGroupId');
    }
    setActiveGroupDetailRaw(group);
  };
  const [showJoinGroup, setShowJoinGroup] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  
  // Interactive UI
  const [passcode, setPasscode] = useState('');
  const [joinError, setJoinError] = useState('');
  const [joinSuccess, setJoinSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  
  // Upload States (now map to assignmentId for multi-assignment view)
  const [uploadLoading, setUploadLoading] = useState({});
  const [dragActive, setDragActive] = useState({});
  const [stagedFiles, setStagedFiles] = useState({}); // { assignmentId: [files] }

  const loadStudentData = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      // 1. Fetch Users
      const usersSnap = await getDocs(collection(db, 'users'));
      const usersMap = {};
      usersSnap.forEach(d => { usersMap[d.id] = d.data(); });
      setAllUsers(usersMap);

      // 2. Fetch All Groups (for passcode look-ups)
      const allGroupsSnap = await getDocs(collection(db, 'groups'));
      const allGroupsList = [];
      allGroupsSnap.forEach(d => {
        allGroupsList.push({ groupId: d.id, ...d.data() });
      });
      setAllGroups(allGroupsList);

      // Filter groups where student is enrolled OR pending
      const enrolledOrPending = allGroupsList.filter(g => 
        (g.members && g.members.includes(currentUser.uid)) || 
        (g.pendingApprovals && g.pendingApprovals.includes(currentUser.uid))
      );
      setGroups(enrolledOrPending);

      // 3. Fetch Assignments
      const assignmentsList = [];
      const assignSnap = await getDocs(collection(db, 'assignments'));
      assignSnap.forEach(d => {
        assignmentsList.push({ assignmentId: d.id, ...d.data() });
      });
      setAssignments(assignmentsList);

      // 4. Fetch Submissions
      const subSnap = await getDocs(collection(db, 'submissions'));
      const submissionsList = [];
      subSnap.forEach(d => {
        submissionsList.push({ submissionId: d.id, ...d.data() });
      });
      setSubmissions(submissionsList);

    } catch (error) {
      console.error("Error loading student assets:", error);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    loadStudentData();
  }, [loadStudentData]);

  // Restore active group detail from sessionStorage after data loads
  useEffect(() => {
    if (!loading && groups.length > 0 && !activeGroupDetail) {
      const savedGroupId = sessionStorage.getItem('student_activeGroupId');
      if (savedGroupId) {
        const found = groups.find(g => g.groupId === savedGroupId);
        if (found) {
          setActiveGroupDetailRaw(found);
        } else {
          sessionStorage.removeItem('student_activeGroupId');
        }
      }
    }
  }, [loading, groups, activeGroupDetail]);

  useEffect(() => {
    const handleNav = (e) => {
      const { groupId, assignmentId } = e.detail;
      if (groupId && groups.length > 0) {
        const group = groups.find(g => g.groupId === groupId);
        if (group) {
          setActiveGroupDetail(group);
          if (assignmentId) {
            setTimeout(() => {
              const el = document.getElementById(`assignment-${assignmentId}`);
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 500);
          }
        }
      }
    };
    window.addEventListener('dashboardNav', handleNav);
    return () => window.removeEventListener('dashboardNav', handleNav);
  }, [groups]);

  // Passcode Joining Pipeline
  const handleJoinGroup = async (e) => {
    e.preventDefault();
    if (!passcode) return;
    setJoinError('');
    setJoinSuccess('');

    // Find group by passcode
    const targetGroup = allGroups.find(g => g.passcode.trim() === passcode.trim());

    if (!targetGroup) {
      setJoinError("Invalid classroom entry passcode.");
      return;
    }

    if (targetGroup.bannedUsers && targetGroup.bannedUsers.includes(currentUser.uid)) {
      setJoinError("Access denied. You have been banned from this group.");
      return;
    }

    if (targetGroup.members && targetGroup.members.includes(currentUser.uid)) {
      setJoinSuccess("You are already enrolled in this class.");
      return;
    }

    const groupRef = doc(db, 'groups', targetGroup.groupId);

    try {
      if (targetGroup.isPublic) {
        await updateDoc(groupRef, {
          members: arrayUnion(currentUser.uid)
        });
        setJoinSuccess(`Enrolled successfully in "${targetGroup.name}"!`);
      } else {
        if (targetGroup.pendingApprovals && targetGroup.pendingApprovals.includes(currentUser.uid)) {
          setJoinSuccess("Entry request is already pending teacher review.");
          return;
        }
        await updateDoc(groupRef, {
          pendingApprovals: arrayUnion(currentUser.uid)
        });
        setJoinSuccess(`Entry request submitted for "${targetGroup.name}". Awaiting teacher approval.`);
      }
      
      setPasscode('');
      await loadStudentData();
      
      // Auto-close modal on success after 2s
      setTimeout(() => {
        setShowJoinGroup(false);
        setJoinSuccess('');
      }, 2000);

    } catch (err) {
      console.error(err);
      setJoinError("Failed to update classroom enrollment.");
    }
  };

  const handleLeaveGroup = async (groupId, groupName) => {
    if (!window.confirm(`Are you sure you want to leave "${groupName}"?`)) return;

    try {
      const groupRef = doc(db, 'groups', groupId);
      const group = allGroups.find(g => g.groupId === groupId);
      if(group) {
         const updatedMembers = (group.members || []).filter(uid => uid !== currentUser.uid);
         const updatedPending = (group.pendingApprovals || []).filter(uid => uid !== currentUser.uid);
         await updateDoc(groupRef, { members: updatedMembers, pendingApprovals: updatedPending });
      }
      
      if (activeGroupDetail?.groupId === groupId) {
        setActiveGroupDetail(null);
      }
      
      await loadStudentData();
    } catch (err) {
      console.error(err);
      alert("Failed to leave classroom.");
    }
  };

  // Stage files
  const stageFiles = (assignment, fileList) => {
    const fileLimit = 6 * 1024 * 1024;
    const newFiles = [];
    for (const file of fileList) {
      if (file.size > fileLimit) {
        alert(`"${file.name}" exceeds the 6MB limit. Skipped.`);
        continue;
      }
      const isAllowed = validateFileType(file.name, assignment.allowedTypes);
      if (!isAllowed) {
        alert(`"${file.name}" is not an allowed file type. Skipped.`);
        continue;
      }
      newFiles.push(file);
    }
    if (newFiles.length > 0) {
      setStagedFiles(prev => ({
        ...prev,
        [assignment.assignmentId]: [...(prev[assignment.assignmentId] || []), ...newFiles]
      }));
    }
  };

  const removeStagedFile = (assignmentId, index) => {
    setStagedFiles(prev => ({
      ...prev,
      [assignmentId]: prev[assignmentId].filter((_, i) => i !== index)
    }));
  };

  // Submit staged files
  const handleSubmitAll = async (assignment) => {
    const currentStaged = stagedFiles[assignment.assignmentId] || [];
    if (currentStaged.length === 0) return;
    
    setUploadLoading(prev => ({...prev, [assignment.assignmentId]: true}));

    try {
      for (const file of currentStaged) {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch(`${import.meta.env.VITE_API_URL}/api/upload`, {
          method: 'POST',
          body: formData
        });

        if (!response.ok) throw new Error(`Upload failed for ${file.name}`);

        const uploadResult = await response.json();

        await addDoc(collection(db, 'submissions'), {
          assignmentId: assignment.assignmentId,
          groupId: assignment.groupId,
          studentId: currentUser.uid,
          studentName: currentUser.displayName || 'Anonymous Student',
          fileUrl: uploadResult.url,
          fileName: file.name,
          backendFilename: uploadResult.file.filename,
          submittedAt: serverTimestamp()
        });
      }

      setStagedFiles(prev => ({...prev, [assignment.assignmentId]: []}));
      await loadStudentData();
      alert('Files submitted successfully!');
    } catch (err) {
      console.error('Upload failed:', err);
      alert(`File upload failed: ${err.message}`);
    } finally {
      setUploadLoading(prev => ({...prev, [assignment.assignmentId]: false}));
    }
  };

  const handleDrag = (e, assignmentId) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(prev => ({...prev, [assignmentId]: true}));
    } else if (e.type === 'dragleave' || e.type === 'drop') {
      setDragActive(prev => ({...prev, [assignmentId]: false}));
    }
  };

  const handleDrop = (e, assignment) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(prev => ({...prev, [assignment.assignmentId]: false}));
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      stageFiles(assignment, e.dataTransfer.files);
    }
  };

  const handleFileChange = (e, assignment) => {
    if (e.target.files && e.target.files.length > 0) {
      stageFiles(assignment, e.target.files);
      e.target.value = '';
    }
  };

  const handleRescind = async (submission, assignment) => {
    const dueTime = assignment.dueDate?.toDate 
      ? assignment.dueDate.toDate() 
      : new Date(assignment.dueDate);
      
    if (new Date() > dueTime) {
      alert("Submission cannot be rescinded. The assignment deadline has passed.");
      return;
    }

    if (!window.confirm("Are you sure you want to RESCIND this submission? This will delete the file from the cloud.")) return;

    setUploadLoading(prev => ({...prev, [assignment.assignmentId]: true}));

    try {
      if (submission.backendFilename) {
        try {
          await fetch(`${import.meta.env.VITE_API_URL}/api/files/${submission.backendFilename}`, { method: 'DELETE' });
        } catch (backendErr) {
          console.warn("Backend deletion error", backendErr);
        }
      }
      await deleteDoc(doc(db, 'submissions', submission.submissionId));
      await loadStudentData();
    } catch (err) {
      console.error("Rescind failed:", err);
      alert("Failed to rescind submission.");
    } finally {
      setUploadLoading(prev => ({...prev, [assignment.assignmentId]: false}));
    }
  };

  const handleGoToAssignment = (assignment) => {
    const group = groups.find(g => g.groupId === assignment.groupId);
    if (group) {
      setActiveGroupDetail(group);
      setTimeout(() => {
        const el = document.getElementById(`assignment-${assignment.assignmentId}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 300);
    }
  };

  if (loading) {
    return (
      <div className="empty-state">
        <div className="stat-icon" style={{ animation: 'spin 1.5s linear infinite' }}><BookOpen size={28} /></div>
        <p>Syncing class enrollment matrices and fetching active deadlines...</p>
      </div>
    );
  }

  // Active Group filtering
  const groupAssignments = activeGroupDetail ? assignments.filter(a => a.groupId === activeGroupDetail.groupId) : [];
  
  // Dashboard view data
  const fullyEnrolledGroupIds = groups.filter(g => g.members && g.members.includes(currentUser.uid)).map(g => g.groupId);
  const enrolledAssignments = assignments.filter(a => fullyEnrolledGroupIds.includes(a.groupId));
  
  // Find unsubmitted assignments with future due dates
  const unsubmittedAssignments = enrolledAssignments.filter(a => {
    const hasSubmitted = submissions.some(s => s.assignmentId === a.assignmentId && s.studentId === currentUser.uid);
    const dueTime = a.dueDate?.toDate ? a.dueDate.toDate() : new Date(a.dueDate);
    const isOverdue = new Date() > dueTime;
    return !hasSubmitted && !isOverdue;
  });

  return (
    <>
      {activeGroupDetail ? (
        <div className="animate-fade-in">
          <button 
            className="btn btn-secondary" 
            style={{ marginBottom: '20px' }} 
            onClick={() => setActiveGroupDetail(null)}
          >
            <ChevronLeft size={16} /> Back to Dashboard
          </button>

          {/* Group Header */}
          <div className="glass section-card" style={{ position: 'relative' }}>
            <div style={{ position: 'absolute', top: '16px', right: '16px', display: 'flex', gap: '8px' }}>
              <button className="btn btn-secondary" onClick={() => setShowMembers(true)} title="See Members">
                <Users size={14} /> See Members
              </button>
              <button className="btn btn-danger" onClick={() => handleLeaveGroup(activeGroupDetail.groupId, activeGroupDetail.name)} title="Leave Classroom">
                <LogOut size={14} /> Leave
              </button>
            </div>
            <h1 style={{ fontSize: '24px', marginBottom: '8px' }}>{activeGroupDetail.name}</h1>
            <p style={{ color: 'var(--text-muted)', marginBottom: '16px', maxWidth: '80%' }}>{activeGroupDetail.description}</p>
            <div className="flex-gap-10" style={{ fontSize: '13px' }}>
              <span className={`badge ${activeGroupDetail.isPublic ? 'badge-success' : 'badge-pending'}`}>
                {activeGroupDetail.isPublic ? 'Public' : 'Private'}
              </span>
              <span className="glass" style={{ padding: '4px 10px', borderRadius: '16px' }}>
                <Users size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }}/>
                {(activeGroupDetail.members || []).length} Students
              </span>
            </div>
          </div>

          {/* Assignments List for the Group */}
          <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <h2 style={{ fontSize: '18px' }} className="flex-gap-10"><BookOpen size={20} className="text-primary" /> Assignments</h2>
            
            {groupAssignments.length === 0 ? (
              <div className="empty-state glass">No assignments posted for this classroom yet.</div>
            ) : (
              groupAssignments.map(assignment => {
                const isDragActive = dragActive[assignment.assignmentId] || false;
                const isUploading = uploadLoading[assignment.assignmentId] || false;
                const currentStaged = stagedFiles[assignment.assignmentId] || [];
                const studentSubs = submissions.filter(
                  s => s.assignmentId === assignment.assignmentId && s.studentId === currentUser.uid
                );
                
                // Peer subs
                const peerSubs = submissions.filter(
                  s => s.assignmentId === assignment.assignmentId && s.studentId !== currentUser.uid
                );

                return (
                  <div key={assignment.assignmentId} id={`assignment-${assignment.assignmentId}`} className="glass section-card" style={{ scrollMarginTop: '20px' }}>
                    <div className="flex-between" style={{ marginBottom: '12px' }}>
                      <h3 style={{ fontSize: '18px', margin: 0 }}>{assignment.name}</h3>
                      <button className="btn btn-secondary" onClick={() => onOpenChat(assignment)}>
                        <MessageSquare size={14} /> Forum
                      </button>
                    </div>

                    <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px', lineHeight: '1.5' }}>
                      {parseDescriptionLinks(assignment.description)}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', fontSize: '13px', marginBottom: '24px' }}>
                      <div><strong>Start:</strong> {formatDate(assignment.startDate)}</div>
                      <div><strong>Due:</strong> {formatDate(assignment.dueDate)}</div>
                    </div>

                    {/* Submission Section */}
                    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
                      <h4 style={{ fontSize: '14px', marginBottom: '12px' }}>Your Submission</h4>
                      
                      {studentSubs.length > 0 ? (
                        <div className="glass" style={{ padding: '16px', background: 'rgba(16, 185, 129, 0.04)' }}>
                          <div className="flex-between" style={{ marginBottom: '12px' }}>
                            <span style={{ fontWeight: 600, fontSize: '14px' }}>{studentSubs.length} file(s) submitted</span>
                            <span className="badge badge-success">Delivered</span>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
                            {studentSubs.map(sub => (
                              <div key={sub.submissionId} className="flex-between glass" style={{ padding: '8px 12px', fontSize: '13px' }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                  <FileText size={14} className="text-success" />
                                  <a href={sub.fileUrl} target="_blank" rel="noopener noreferrer" className="parsed-link">
                                    {sub.fileName || 'View file'}
                                  </a>
                                </span>
                                <button
                                  className="btn btn-danger"
                                  style={{ padding: '4px 8px', fontSize: '11px' }}
                                  onClick={() => handleRescind(sub, assignment)}
                                  disabled={isUploading}
                                  title="Remove this file"
                                >
                                  <XCircle size={12} />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div 
                            className={`dropzone ${isDragActive ? 'active' : ''}`}
                            onDragEnter={e => handleDrag(e, assignment.assignmentId)}
                            onDragOver={e => handleDrag(e, assignment.assignmentId)}
                            onDragLeave={e => handleDrag(e, assignment.assignmentId)}
                            onDrop={e => handleDrop(e, assignment)}
                            onClick={() => document.getElementById(`file-upload-${assignment.assignmentId}`).click()}
                          >
                            <UploadCloud size={36} className="dropzone-icon" />
                            <div>
                              <p style={{ fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>
                                {isUploading ? 'Uploading files...' : 'Drag & drop files or click to browse'}
                              </p>
                              <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                Max 6MB per file.
                              </p>
                            </div>
                            <input 
                              id={`file-upload-${assignment.assignmentId}`}
                              type="file" 
                              multiple
                              style={{ display: 'none' }}
                              onChange={e => handleFileChange(e, assignment)}
                              disabled={isUploading}
                            />
                          </div>

                          {currentStaged.length > 0 && (
                            <div style={{ marginTop: '12px' }}>
                              <h5 style={{ fontSize: '13px', marginBottom: '8px', color: 'var(--text-muted)' }}>
                                {currentStaged.length} file(s) ready to submit:
                              </h5>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
                                {currentStaged.map((f, i) => (
                                  <div key={i} className="flex-between glass" style={{ padding: '8px 12px', fontSize: '13px' }}>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                      <FileText size={14} />
                                      <span>{f.name}</span>
                                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>({(f.size / 1024).toFixed(0)} KB)</span>
                                    </span>
                                    <button
                                      className="btn btn-danger"
                                      style={{ padding: '4px 8px', fontSize: '11px' }}
                                      onClick={() => removeStagedFile(assignment.assignmentId, i)}
                                      title="Remove file"
                                    >
                                      <XCircle size={12} />
                                    </button>
                                  </div>
                                ))}
                              </div>
                              <button
                                className="btn btn-primary"
                                style={{ width: '100%', padding: '12px' }}
                                onClick={() => handleSubmitAll(assignment)}
                                disabled={isUploading}
                              >
                                <UploadCloud size={16} />
                                <span>{isUploading ? 'Submitting...' : `Submit ${currentStaged.length} File(s)`}</span>
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Peer Submissions */}
                    <div style={{ marginTop: '24px', borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
                      <h4 style={{ fontSize: '14px', marginBottom: '12px' }}>Classmate Activity</h4>
                      {peerSubs.length === 0 ? (
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No classmate submissions yet.</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {peerSubs.map(sub => (
                            <div key={sub.submissionId} className="flex-between glass" style={{ padding: '10px 14px', fontSize: '13px' }}>
                              <span>{sub.studentName}</span>
                              {assignment.shareVisibility ? (
                                <a 
                                  href={sub.fileUrl} 
                                  target="_blank" 
                                  rel="noopener noreferrer" 
                                  className="parsed-link flex-gap-10"
                                >
                                  <FileText size={14} /> {sub.fileName || 'View file'}
                                </a>
                              ) : (
                                <span className="flex-gap-10 text-muted" style={{ fontSize: '12px', fontStyle: 'italic' }}>
                                  <FileText size={14} /> {sub.fileName || 'Uploaded a file'}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : (
        <div className="animate-fade-in">
          <div className="dashboard-header flex-between" style={{ alignItems: 'flex-start' }}>
            <div>
              <h1 className="dashboard-title">Student Dashboard</h1>
              <p className="dashboard-subtitle">Manage your classrooms and stay on top of pending assignments.</p>
            </div>
            <button className="btn btn-primary" onClick={() => setShowJoinGroup(true)}>
              <Plus size={18} /> Join Group
            </button>
          </div>

          <div className="grid-columns-2" style={{ marginTop: '24px' }}>
            
            {/* Classrooms List View */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <h2 style={{ fontSize: '18px' }} className="flex-gap-10"><Users size={20} className="text-primary" /> My Classrooms</h2>
              {groups.length === 0 ? (
                <div className="empty-state glass">
                  You haven't joined any classrooms yet. Click "Join Group" to enter a passcode.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {groups.map(g => {
                    const isPending = g.pendingApprovals && g.pendingApprovals.includes(currentUser.uid);
                    return (
                      <div 
                        key={g.groupId} 
                        className={`glass section-card ${!isPending ? 'glass-interactive' : ''}`}
                        style={{ cursor: isPending ? 'default' : 'pointer', transition: 'all 0.2s', opacity: isPending ? 0.7 : 1 }}
                        onClick={() => { if (!isPending) setActiveGroupDetail(g); }}
                      >
                        <div className="flex-between" style={{ marginBottom: '12px' }}>
                          <span className={`badge ${isPending ? 'badge-warning' : 'badge-success'}`}>
                            {isPending ? 'Pending Approval' : 'Enrolled'}
                          </span>
                          {!isPending && (
                            <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <Users size={14} /> {(g.members || []).length}
                            </span>
                          )}
                        </div>
                        <h3 style={{ fontSize: '18px', margin: '0 0 8px 0' }}>{g.name}</h3>
                        <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {g.description || 'No description provided.'}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Unsubmitted Assignments Section */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <h2 style={{ fontSize: '18px' }} className="flex-gap-10"><Clock size={20} className="text-warning" /> Action Required</h2>
              {unsubmittedAssignments.length === 0 ? (
                <div className="empty-state glass" style={{ padding: '20px', textAlign: 'center' }}>
                  <p>You're all caught up!</p>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No pending assignments across your enrolled classrooms.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {unsubmittedAssignments.map(a => {
                    const group = groups.find(g => g.groupId === a.groupId);
                    return (
                      <div 
                        key={a.assignmentId} 
                        className="glass glass-interactive section-card"
                        style={{ padding: '16px', cursor: 'pointer' }}
                        onClick={() => handleGoToAssignment(a)}
                      >
                        <div style={{ fontSize: '12px', color: 'var(--primary)', marginBottom: '4px', fontWeight: 600 }}>
                          {group?.name || 'Unknown Classroom'}
                        </div>
                        <div className="flex-between">
                          <h4 style={{ fontSize: '16px', margin: '0 0 8px 0' }}>{a.name}</h4>
                          <span className="badge badge-pending">Due Soon</span>
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                          Due: {formatDate(a.dueDate)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>
        </div>
      )}

      {/* ─── MODALS ─── */}

      {/* Join Group Modal */}
      {showJoinGroup && (
        <div className="modal-overlay" onClick={() => setShowJoinGroup(false)}>
          <div className="modal-content glass animate-fade-in" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div className="flex-between" style={{ marginBottom: '20px' }}>
              <h2 style={{ margin: 0, fontSize: '18px' }}>Join Group</h2>
              <button className="btn btn-secondary" style={{ padding: '4px' }} onClick={() => setShowJoinGroup(false)}><X size={16} /></button>
            </div>
            <form onSubmit={handleJoinGroup}>
              <div className="form-group">
                <label className="form-label">Class Passcode</label>
                <input 
                  type="text" 
                  className="form-input" 
                  value={passcode} 
                  onChange={(e) => setPasscode(e.target.value)} 
                  placeholder="Enter classroom entry passcode..." 
                  required 
                />
              </div>
              {joinError && <div className="badge badge-danger" style={{ display: 'block', padding: '8px', marginBottom: '16px' }}>{joinError}</div>}
              {joinSuccess && <div className="badge badge-success" style={{ display: 'block', padding: '8px', marginBottom: '16px' }}>{joinSuccess}</div>}
              
              <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                <span>Submit Passcode</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* See Members Modal */}
      {showMembers && activeGroupDetail && (
        <div className="modal-overlay" onClick={() => setShowMembers(false)}>
          <div className="modal-content glass animate-fade-in" onClick={e => e.stopPropagation()} style={{ maxWidth: '450px', maxHeight: '80vh', overflowY: 'auto' }}>
            <div className="flex-between" style={{ marginBottom: '20px' }}>
              <h2 style={{ margin: 0, fontSize: '18px' }}>Classroom Members</h2>
              <button className="btn btn-secondary" style={{ padding: '4px' }} onClick={() => setShowMembers(false)}><X size={16} /></button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <h4 style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>
                Enrolled Students ({(activeGroupDetail.members || []).length})
              </h4>
              {(!activeGroupDetail.members || activeGroupDetail.members.length === 0) ? (
                <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No students enrolled.</div>
              ) : (
                activeGroupDetail.members.map(uid => {
                  const profile = allUsers[uid] || { name: 'Unknown Student', email: uid };
                  const isMe = uid === currentUser.uid;
                  return (
                    <div key={uid} className="flex-between glass" style={{ padding: '12px' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '14px' }}>
                          {profile.name} {isMe && <span className="badge badge-secondary" style={{ marginLeft: '8px' }}>You</span>}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{profile.email}</div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

    </>
  );
}

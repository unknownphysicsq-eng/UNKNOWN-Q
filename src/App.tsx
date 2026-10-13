import React, { useEffect, useRef, useState } from 'react';

interface User {
  id: string;
  name: string;
  course: string;
  role?: string;
}

interface AdminStatsData {
  total_students: number;
  active_students: number;
  waiting_students: number;
  blocked_requests: number;
  total_submissions?: number;
  admin_name?: string;
}

interface AdminTrafficData {
  points: number[];
  labels: string[];
  total_events?: number;
  breakdown?: {
    queue_joins: number;
    admissions: number;
    submissions: number;
    blocked_requests: number;
    logins?: number;
  };
}

interface SubmissionEntry {
  studentId: string;
  service: string;
  date: string;
  reference: string;
  details: Record<string, string>;
}

type ServiceKey = 'exam' | 'scholarship' | 'course';
type PageId =
  | 'home'
  | 'service'
  | 'overview'
  | 'workspace'
  | 'queue'
  | 'formPage'
  | 'success'
  | 'submissions'
  | 'settings'
  | 'admin';

export interface ServiceItem {
  id?: number;
  code?: string;
  name: string;
  icon: string;
  description: string;
  deadline: string;
  status: string;
  capacity?: number;
  academic_year?: string;
}

const defaultServices: Record<ServiceKey, ServiceItem> = {
  exam: {
    id: 1,
    code: 'exam',
    name: 'Exam Registration',
    icon: '📝',
    description: 'Register for your upcoming semester examinations.',
    deadline: 'Oct 30',
    status: 'Open Now',
    capacity: 500,
    academic_year: '2026–27',
  },
  scholarship: {
    id: 2,
    code: 'scholarship',
    name: 'Scholarship Application',
    icon: '🎓',
    description: 'Apply for merit-based financial aid and scholarships.',
    deadline: 'Nov 12',
    status: 'Limited Slots',
    capacity: 150,
    academic_year: '2026–27',
  },
  course: {
    id: 3,
    code: 'course',
    name: 'Course Enrollment',
    icon: '📚',
    description: 'Choose electives and enroll in next semester courses.',
    deadline: 'Nov 20',
    status: 'Enrollment Open',
    capacity: 300,
    academic_year: '2026–27',
  },
};

const navItems: [ string, string, string ][] = [
  ['home', '▦', 'Dashboard'],
  ['exam', '☷', 'Exam Registration'],
  ['scholarship', '🎓', 'Scholarship Application'],
  ['course', '▤', 'Course Enrollment'],
  ['submissions', '✓', 'My Submissions'],
  ['settings', '⚙', 'Settings'],
  ['admin', '▥', 'Admin Dashboard'],
];

const departments = [
  'Computer Science and Engineering (CSE)',
  'Information Technology (IT)',
  'Artificial Intelligence and Data Science (AI & DS)',
  'Artificial Intelligence and Machine Learning (AI & ML)',
  'Cyber Security',
  'Electronics and Communication Engineering (ECE)',
  'Electrical and Electronics Engineering (EEE)',
  'Mechanical Engineering',
  'Civil Engineering',
  'Chemical Engineering',
  'Biomedical Engineering',
  'Biotechnology',
  'Automobile Engineering',
  'Mechatronics Engineering',
  'Aerospace Engineering',
  'Robotics and Automation',
  'Computer Science and Business Systems',
  'MBA',
  'MCA',
  'Other',
];

export default function App() {
  // Exact state matching the existing FairForm AI frontend script
  const [user, setUser] = useState<User | null>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem('fairform_demo_user') || 'null');
      if (saved && saved.id && saved.name) {
        return { id: saved.id, name: saved.name, course: saved.course || '', role: saved.role || 'student' };
      }
    } catch {
      // ignore
    }
    return null;
  });

  const [selected, setSelected] = useState<ServiceKey>('exam');
  const [currentPage, setCurrentPage] = useState<PageId>('home');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Dynamic Academic Services Catalog (loaded from GET /api/services)
  const [services, setServices] = useState<Record<ServiceKey, ServiceItem>>(defaultServices);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // Real Admin Dashboard State (Loaded from GET /api/admin/stats & GET /api/admin/traffic)
  const [adminStats, setAdminStats] = useState<AdminStatsData | null>(null);
  const [adminTraffic, setAdminTraffic] = useState<AdminTrafficData | null>(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);

  // Login form inputs
  const [loginId, setLoginId] = useState('');
  const [loginName, setLoginName] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Settings form inputs
  const [settingsName, setSettingsName] = useState('');
  const [settingsCourse, setSettingsCourse] = useState('');

  // Submissions & Rate Limit Allowance
  const [submissions, setSubmissions] = useState<SubmissionEntry[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('fairform_records') || '[]');
    } catch {
      return [];
    }
  });
  const requestsRef = useRef<number[]>([]);
  const [allowanceText, setAllowanceText] = useState('05/05');

  // Real Virtual Queue State (FastAPI + Redis Sorted Sets)
  const [queuePosition, setQueuePosition] = useState<number>(1);
  const [studentsAhead, setStudentsAhead] = useState<number>(0);
  const [totalInQueue, setTotalInQueue] = useState<number>(0);
  const [estimatedWaitSeconds, setEstimatedWaitSeconds] = useState<number>(0);
  const [queueStatus, setQueueStatus] = useState<'idle' | 'waiting' | 'admitted' | 'error' | 'rate_limited'>('idle');
  const [admissionToken, setAdmissionToken] = useState<string | null>(null);
  const [tokenExpiresIn, setTokenExpiresIn] = useState<number | null>(null);
  const [isJoiningQueue, setIsJoiningQueue] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const queuePollingRef = useRef<number | null>(null);

  // Success message state
  const [successMessage, setSuccessMessage] = useState('');

  // Toast notification state
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  // Canvas ref for Admin Traffic chart
  const chartRef = useRef<HTMLCanvasElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  function notify(msg: string) {
    setToastMessage(msg);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
    }, 3200);
  }

  function updateStats() {
    requestsRef.current = requestsRef.current.filter((t) => Date.now() - t < 60000);
    const remaining = Math.max(0, 5 - requestsRef.current.length);
    setAllowanceText(String(remaining).padStart(2, '0') + '/05');
  }

  useEffect(() => {
    updateStats();
    const id = window.setInterval(updateStats, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSidebarOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  function stopQueuePolling() {
    if (queuePollingRef.current !== null) {
      window.clearInterval(queuePollingRef.current);
      queuePollingRef.current = null;
    }
  }

  async function leaveQueueApi() {
    stopQueuePolling();
    if (!user) return;
    try {
      await fetch(`/api/queue/leave?student_id=${encodeURIComponent(user.id)}&service_code=${encodeURIComponent(selected)}`, {
        method: 'DELETE',
      });
    } catch {
      // ignore
    }
    setAdmissionToken(null);
    setQueueStatus('idle');
    setQueueError(null);
  }

  function page(rawId: string) {
    if (!user) return;
    let targetId = rawId;
    if (rawId === 'exam' || rawId === 'scholarship' || rawId === 'course') {
      setSelected(rawId);
      targetId = 'service';
    }
    // If navigating away from queue view (except to form when admitted), leave queue
    if (currentPage === 'queue' && targetId !== 'queue' && targetId !== 'formPage') {
      leaveQueueApi();
    } else if (targetId !== 'queue') {
      stopQueuePolling();
    }
    const validPages: PageId[] = [
      'home',
      'service',
      'overview',
      'workspace',
      'queue',
      'formPage',
      'success',
      'submissions',
      'settings',
      'admin',
    ];
    if (!validPages.includes(targetId as PageId)) return;

    if (targetId === 'settings' && user) {
      setSettingsName(user.name);
      setSettingsCourse(user.course || '');
      fetchMyProfile();
    }

    if (targetId === 'submissions' && user) {
      fetchMySubmissions();
    }

    if (targetId === 'admin') {
      fetchAdminData();
    }

    setCurrentPage(targetId as PageId);
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }

  async function fetchAdminData() {
    setAdminLoading(true);
    setAdminError(null);
    const token = sessionStorage.getItem('fairform_token');

    try {
      const [statsRes, trafficRes] = await Promise.all([
        fetch('/api/admin/stats', {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        }),
        fetch('/api/admin/traffic', {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        }),
      ]);

      if (statsRes.status === 403 || trafficRes.status === 403) {
        setAdminLoading(false);
        setAdminError('Access Denied: Administrator account required (e.g. ADMIN-001).');
        notify('Admin access restricted. Administrator account required.');
        return;
      }

      if (statsRes.status === 401 || trafficRes.status === 401) {
        setAdminLoading(false);
        setAdminError('Authentication required. Please sign in as an administrator.');
        notify('Please sign in with administrator credentials.');
        return;
      }

      if (!statsRes.ok || !trafficRes.ok) {
        setAdminLoading(false);
        setAdminError('Failed to load metrics from server.');
        return;
      }

      const statsData = await statsRes.json();
      const trafficData = await trafficRes.json();

      setAdminStats(statsData);
      setAdminTraffic(trafficData);
      setAdminLoading(false);
    } catch {
      setAdminLoading(false);
      setAdminError('Network error connecting to admin metrics API.');
    }
  }

  // Draw admin chart from real timestamped database events
  useEffect(() => {
    if (currentPage !== 'admin' || !chartRef.current) return;
    const drawChart = () => {
      const c = chartRef.current;
      if (!c) return;
      const w = Math.max(280, c.clientWidth);
      const h = 240;
      const d = window.devicePixelRatio || 1;
      c.width = w * d;
      c.height = h * d;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.scale(d, d);
      ctx.strokeStyle = '#e5e8f2';
      for (let i = 0; i < 5; i++) {
        const y = 20 + i * 47;
        ctx.beginPath();
        ctx.moveTo(25, y);
        ctx.lineTo(w - 15, y);
        ctx.stroke();
      }
      const values = adminTraffic?.points?.length
        ? adminTraffic.points
        : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      const maxVal = Math.max(5, ...values);
      ctx.beginPath();
      values.forEach((v, i) => {
        const x = 25 + (i * (w - 45)) / Math.max(1, values.length - 1);
        const y = 208 - (v / maxVal) * 160;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.strokeStyle = '#604de8';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Point circles
      values.forEach((v, i) => {
        const x = 25 + (i * (w - 45)) / Math.max(1, values.length - 1);
        const y = 208 - (v / maxVal) * 160;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#604de8';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      });
    };
    drawChart();
    window.addEventListener('resize', drawChart);
    return () => window.removeEventListener('resize', drawChart);
  }, [currentPage, adminTraffic]);

  // Polling loop for Virtual Queue Status (every 2 seconds)
  function startPollingQueue() {
    stopQueuePolling();
    queuePollingRef.current = window.setInterval(async () => {
      if (!user) {
        stopQueuePolling();
        return;
      }
      try {
        const res = await fetch(
          `/api/queue/status?student_id=${encodeURIComponent(user.id)}&service_code=${encodeURIComponent(selected)}`
        );
        if (res.status === 404) {
          stopQueuePolling();
          setQueueStatus('error');
          setQueueError('Queue session expired or removed. Please join again.');
          notify('Queue session expired. Please join again.');
          return;
        }
        if (res.status === 429) {
          notify('Polling rate limit reached. Waiting for next window.');
          return;
        }
        if (!res.ok) {
          return;
        }
        const data = await res.json();
        setQueuePosition(data.queue_position);
        setStudentsAhead(data.students_ahead);
        setTotalInQueue(data.total_in_queue);
        setEstimatedWaitSeconds(data.estimated_wait_seconds);
        setQueueStatus(data.status);

        if (data.status === 'admitted' && data.admission_token) {
          setAdmissionToken(data.admission_token);
          setTokenExpiresIn(data.token_expires_in || 600);
          stopQueuePolling();
          notify('🎉 Your turn has arrived! Admission token verified. You can now open the form.');
        }
      } catch {
        // Network blip: keep current state and retry on next tick
      }
    }, 2000);
  }

  // Join the queue through the backend API
  async function startQueue() {
    if (!user) {
      notify('Please sign in first.');
      return;
    }
    updateStats();
    stopQueuePolling();
    setIsJoiningQueue(true);
    setQueueError(null);
    setAdmissionToken(null);

    try {
      const res = await fetch('/api/queue/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: user.id,
          service_code: selected,
        }),
      });

      const data = await res.json();

      if (res.status === 429) {
        setIsJoiningQueue(false);
        setQueueStatus('rate_limited');
        const retryAfter = res.headers.get('Retry-After') || data.retry_after || '60';
        const msg = data.detail || `Queue join limit reached (max 5 per 60s). Please wait ${retryAfter}s.`;
        setQueueError(msg);
        notify(msg);
        return;
      }

      if (!res.ok) {
        setIsJoiningQueue(false);
        setQueueStatus('error');
        const msg = data.detail || 'Failed to join waiting queue.';
        setQueueError(msg);
        notify(msg);
        return;
      }

      setQueuePosition(data.queue_position);
      setStudentsAhead(data.students_ahead);
      setTotalInQueue(data.total_in_queue);
      setEstimatedWaitSeconds(data.estimated_wait_seconds);
      setQueueStatus(data.status);
      setAdmissionToken(data.admission_token || null);
      setTokenExpiresIn(data.token_expires_in || null);
      setIsJoiningQueue(false);

      setCurrentPage('queue');
      setSidebarOpen(false);
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });

      if (data.status === 'admitted' && data.admission_token) {
        notify('Your turn has arrived! Admission token issued.');
      } else {
        // Start real-time 2-second server polling
        startPollingQueue();
      }
    } catch {
      setIsJoiningQueue(false);
      setQueueStatus('error');
      setQueueError('Network error connecting to queue server.');
      notify('Network error connecting to queue server.');
    }
  }

  // Explicitly leave the queue when exiting
  async function handleExitQueue() {
    await leaveQueueApi();
    notify('You have left the virtual waiting room.');
    page('workspace');
  }

  async function handleLoginSubmit(e: React.FormEvent) {
    e.preventDefault();
    const id = loginId.trim();
    const pass = loginPassword;
    if (!id || !pass) {
      notify('Please enter your Student ID and password.');
      return;
    }
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: id, password: pass }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify(data.detail || 'Authentication failed. Please check credentials.');
        return;
      }
      const verifiedUser: User = {
        id: data.user.id,
        name: data.user.name,
        course: data.user.course || '',
        role: data.user.role || 'student',
      };
      sessionStorage.setItem('fairform_token', data.access_token);
      sessionStorage.setItem('fairform_demo_user', JSON.stringify(verifiedUser));
      setUser(verifiedUser);
      setLoginPassword('');
      updateStats();
      setCurrentPage('home');
      setSidebarOpen(false);
      notify(`Welcome back, ${verifiedUser.name}!`);
    } catch {
      notify('Unable to connect to authentication server.');
    }
  }

  function signOut() {
    leaveQueueApi();
    setUser(null);
    try {
      sessionStorage.removeItem('fairform_demo_user');
      sessionStorage.removeItem('fairform_token');
    } catch {
      // ignore
    }
    setSidebarOpen(false);
    setLoginId('');
    setLoginName('');
    setLoginPassword('');
  }

  async function fetchMySubmissions() {
    if (!user) return;
    const token = sessionStorage.getItem('fairform_token');
    try {
      const res = await fetch('/api/applications', {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (res.ok) {
        const list = await res.json();
        const mapped: SubmissionEntry[] = list.map((item: any) => ({
          studentId: item.student_id,
          service: item.service_name || services[item.service_code as ServiceKey]?.name || 'Academic Application',
          date: item.submission_date,
          reference: item.reference,
          details: item.details || {},
        }));
        setSubmissions(mapped);
      }
    } catch {
      // ignore
    }
  }

  // Submit Application with Server-Issued Admission Token to POST /api/applications
  async function handleApplicationSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!user) return;
    if (queueStatus !== 'admitted' || !admissionToken) {
      notify('Server admission token required. Please join the virtual queue before submitting.');
      page('workspace');
      return;
    }
    if (isSubmitting) return;

    setIsSubmitting(true);
    const formData = new FormData(e.currentTarget);
    const data: Record<string, string> = {};
    formData.forEach((value, key) => {
      data[key] = String(value);
    });

    const token = sessionStorage.getItem('fairform_token');

    try {
      const res = await fetch('/api/applications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          serviceKey: selected,
          admissionToken: admissionToken,
          details: data,
        }),
      });

      const resData = await res.json();

      if (!res.ok) {
        setIsSubmitting(false);
        notify(resData.detail || 'Application submission rejected by server.');
        return;
      }

      const reference = resData.reference || ('FF-' + Date.now().toString(36).toUpperCase());

      const entry: SubmissionEntry = {
        studentId: user.id,
        service: resData.service_name || services[selected].name,
        date: resData.submission_date || new Date().toLocaleString(),
        reference,
        details: resData.details || data,
      };

      const nextSubmissions = [entry, ...submissions.filter((s) => s.reference !== reference)];
      setSubmissions(nextSubmissions);

      // Consume admission token on frontend
      setAdmissionToken(null);
      setQueueStatus('idle');
      setIsSubmitting(false);
      setSuccessMessage(
        `Your ${entry.service} has been verified and recorded in PostgreSQL. Reference number: ${entry.reference}`
      );
      updateStats();
      page('success');
    } catch {
      setIsSubmitting(false);
      notify('Network error submitting application to server.');
    }
  }

  async function fetchServicesCatalog() {
    try {
      const res = await fetch('/api/services');
      if (res.ok) {
        const data = await res.json();
        const list: any[] = Array.isArray(data)
          ? data
          : data.services
          ? Object.values(data.services)
          : [];
        if (list.length > 0) {
          const updated: Record<ServiceKey, ServiceItem> = { ...defaultServices };
          for (const item of list) {
            const key = String(item.code || item.key || '').toLowerCase() as ServiceKey;
            if (key === 'exam' || key === 'scholarship' || key === 'course') {
              updated[key] = {
                id: item.id || defaultServices[key].id,
                code: key,
                name: item.name || defaultServices[key].name,
                icon: item.icon || defaultServices[key].icon,
                description: item.description || defaultServices[key].description,
                deadline: item.deadline || defaultServices[key].deadline,
                status: item.status || defaultServices[key].status,
                capacity: item.capacity || defaultServices[key].capacity,
                academic_year: item.academic_year || item.academicYear || '2026–27',
              };
            }
          }
          setServices(updated);
        }
      }
    } catch {
      // Offline fallback: retains defaultServices
    }
  }

  async function fetchMyProfile() {
    const token = sessionStorage.getItem('fairform_token');
    if (!token) return;
    try {
      const res = await fetch('/api/me', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        const verifiedUser: User = {
          id: data.id,
          name: data.name,
          course: data.course || '',
          role: data.role || 'student',
        };
        setUser(verifiedUser);
        sessionStorage.setItem('fairform_demo_user', JSON.stringify(verifiedUser));
        setSettingsName(data.name);
        setSettingsCourse(data.course || '');
      } else if (res.status === 401) {
        signOut();
        notify('Session expired. Please sign in again.');
      }
    } catch {
      // Network error
    }
  }

  // Load services catalog from PostgreSQL on initial mount
  useEffect(() => {
    fetchServicesCatalog();
  }, []);

  useEffect(() => {
    if (user) {
      fetchMyProfile();
      fetchMySubmissions();
    }
    return () => {
      stopQueuePolling();
    };
  }, [user?.id]);

  async function handleSettingsSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;

    const trimmedName = settingsName.trim();
    if (!trimmedName) {
      notify('Student name cannot be empty.');
      return;
    }

    setIsSavingSettings(true);
    const token = sessionStorage.getItem('fairform_token');

    try {
      const res = await fetch('/api/me', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: trimmedName,
          course: settingsCourse.trim(),
        }),
      });

      const data = await res.json();
      setIsSavingSettings(false);

      if (!res.ok) {
        notify(data.detail || 'Failed to update profile settings.');
        return;
      }

      const updatedUser: User = {
        id: data.id,
        name: data.name,
        course: data.course || '',
        role: data.role || user.role || 'student',
      };
      setUser(updatedUser);
      setSettingsName(data.name);
      setSettingsCourse(data.course || '');
      sessionStorage.setItem('fairform_demo_user', JSON.stringify(updatedUser));
      notify('Profile updated successfully in PostgreSQL');
    } catch {
      setIsSavingSettings(false);
      notify('Network error updating profile.');
    }
  }


  const avatarInitials = user
    ? user.name
        .trim()
        .split(/\s+/)
        .map((x) => x[0])
        .slice(0, 2)
        .join('')
        .toUpperCase()
    : 'ST';

  const mySubmissions = user ? submissions.filter((s) => s.studentId === user.id) : [];
  const submissionCountText = String(mySubmissions.length).padStart(2, '0');
  const activeService = services[selected];

  const isAdmitted = queueStatus === 'admitted' && Boolean(admissionToken);

  const displayQueuePosition = isAdmitted ? 1 : queuePosition;
  const displayStudentsAhead = isAdmitted ? 0 : studentsAhead;
  const queueWaitText = isAdmitted
    ? 'Ready'
    : estimatedWaitSeconds < 60
    ? `~ ${Math.max(15, estimatedWaitSeconds)}s`
    : `~ ${Math.ceil(estimatedWaitSeconds / 60)} min`;
  const queueStatusText = isAdmitted
    ? 'Admitted'
    : queueStatus === 'waiting'
    ? 'In queue'
    : queueStatus === 'rate_limited'
    ? 'Rate Limited'
    : queueStatus === 'error'
    ? 'Reconnecting'
    : 'Joining';
  const queueBarWidth = isAdmitted
    ? '100%'
    : Math.max(10, Math.min(95, 100 - (studentsAhead / Math.max(1, totalInQueue || 5)) * 85)) + '%';
  const queueMessageText = isAdmitted
    ? '✓ You have been admitted! Your secure admission token has been verified by the backend. Click below to continue.'
    : queueStatus === 'rate_limited'
    ? (queueError || 'Rate limit reached: max 5 queue joins per 60 seconds.')
    : queueError
    ? queueError
    : `Processing requests in arrival order via Redis Sorted Sets. There are ${studentsAhead} student${studentsAhead === 1 ? '' : 's'} ahead of you. Keep this tab open.`;

  return (
    <>
      {/* Login Screen */}
      <div id="loginScreen" className={`authscreen ${user ? 'hidden' : ''}`}>
        <form id="loginForm" className="authbox" onSubmit={handleLoginSubmit}>
          <div className="logo">
            ✦ Fair<span>Form</span>{' '}
            <small style={{ fontSize: '13px', color: '#888' }}>AI</small>
          </div>
          <h1>Student Login</h1>
          <p className="muted">Sign in to access your academic portal.</p>
          <div style={{ display: 'grid', gap: '18px', margin: '26px 0' }}>
            <label className="field">
              Student ID
              <input
                id="loginId"
                required
                maxLength={30}
                placeholder="e.g. STU-2026-001"
                autoComplete="username"
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
              />
            </label>
            <label className="field">
              Student Name
              <input
                id="loginName"
                maxLength={80}
                placeholder="Student Name (retrieved from database)"
                value={loginName}
                onChange={(e) => setLoginName(e.target.value)}
              />
            </label>
            <label className="field">
              Password
              <input
                id="loginPassword"
                required
                type="password"
                placeholder="Enter password (e.g. Password@123)"
                autoComplete="current-password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
              />
            </label>
          </div>
          <button className="btn" style={{ width: '100%' }} type="submit">
            Login →
          </button>
          <p className="muted" style={{ fontSize: '12px', marginBottom: 0 }}>
            Sign in with verified credentials (e.g. <strong>STU-2026-001</strong> / <strong>Password@123</strong>, <strong>STU-2026-002</strong> / <strong>Password@123</strong>, or <strong>ADMIN-001</strong> / <strong>Admin@Secure2026</strong>).
          </p>
        </form>
      </div>

      {/* Top Header */}
      <header className="top">
        <button
          id="menuBtn"
          className="iconbtn"
          aria-label="Open navigation"
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen(true)}
        >
          ☰
        </button>
        <div className="logo">
          ✦ Fair<span>Form</span> <span className="subbrand">STUDENT PORTAL</span>
        </div>
        <div className="spacer"></div>
        <button
          id="topAvatar"
          className="avatar"
          aria-label="Open profile"
          onClick={() => setSidebarOpen(true)}
        >
          {avatarInitials}
        </button>
      </header>

      {/* Sidebar Shade & Drawer */}
      <div
        id="shade"
        className={`shade ${sidebarOpen ? '' : 'hidden'}`}
        onClick={() => setSidebarOpen(false)}
      ></div>
      <aside
        id="sidebar"
        className={`sidebar ${sidebarOpen ? 'open' : ''}`}
        aria-label="Main navigation"
      >
        <div className="row">
          <strong className="logo" style={{ fontSize: '19px' }}>
            Student Portal
          </strong>
          <button
            id="closeBtn"
            className="iconbtn"
            aria-label="Close navigation"
            onClick={() => setSidebarOpen(false)}
          >
            ✕
          </button>
        </div>
        <div className="profile">
          <div className="avatar" style={{ display: 'inline-block' }}>
            👤
          </div>
          <strong id="profileName">{user ? user.name : 'Student'}</strong>
          <small id="profileId">{user ? `ID: ${user.id}` : 'Student ID'}</small>
          <br />
          <small id="profileCourse">{user?.course || 'Academic account'}</small>
        </div>
        <nav id="sideNav">
          {navItems.map(([key, icon, label]) => {
            const isActive =
              (['exam', 'scholarship', 'course'].includes(key) &&
                key === selected &&
                ['service', 'overview', 'workspace', 'queue', 'formPage'].includes(currentPage)) ||
              key === currentPage;
            return (
              <button
                key={key}
                type="button"
                className={`navitem ${isActive ? 'active' : ''}`}
                data-page={key}
                onClick={() => page(key)}
              >
                <span className="ico">{icon}</span>
                {label}
              </button>
            );
          })}
        </nav>
        <hr />
        <button className="navitem" data-action="switch" onClick={signOut}>
          <span className="ico">🔄</span>Switch Account
        </button>
        <button className="navitem" data-action="logout" onClick={signOut}>
          <span className="ico">↪</span>Sign Out
        </button>
      </aside>

      {/* Main Content Container */}
      <main className="container">
        {/* 1. Home / Dashboard View */}
        <section id="home" className={`view ${currentPage === 'home' ? '' : 'hidden'}`}>
          <div className="hero">
            <div className="eyebrow" id="welcome">
              {user ? `WELCOME BACK, ${user.name.toUpperCase()}` : 'WELCOME BACK'}
            </div>
            <h1 className="title">
              Your academic journey,
              <br />
              simplified.
            </h1>
            <p className="muted">
              A secure, organized place for your academic services and submissions.
            </p>
          </div>
          <div className="grid">
            <div className="card stat">
              <div className="symbol">📄</div>
              <p>Available Forms</p>
              <strong>03</strong>
              <small>Academic services</small>
            </div>
            <div className="card stat">
              <div className="symbol">✅</div>
              <p>My Submissions</p>
              <strong id="submissionCount">{submissionCountText}</strong>
              <small>Completed applications</small>
            </div>
            <div className="card stat">
              <div className="symbol">⚡</div>
              <p>Request Allowance</p>
              <strong id="allowance">{allowanceText}</strong>
              <small>Demo limit: 5 requests / minute</small>
            </div>
            <div className="card stat">
              <div className="symbol">🛡️</div>
              <p>Fair Access</p>
              <strong>Active</strong>
              <small>Queue-based access demo</small>
            </div>
          </div>
          <h2 className="sectiontitle">Student overview</h2>
          <div className="card">
            <div className="row">
              <div>
                <h2 style={{ margin: '0 0 7px' }}>Welcome to FairForm AI</h2>
                <p className="muted" style={{ margin: 0 }}>
                  Choose an academic service from the navigation menu to begin.
                </p>
              </div>
              <button className="btn" data-page="exam" onClick={() => page('exam')}>
                Go to Exam Registration →
              </button>
            </div>
          </div>
        </section>

        {/* 2. Service View */}
        <section id="service" className={`view ${currentPage === 'service' ? '' : 'hidden'}`}>
          <button className="back" data-page="home" onClick={() => page('home')}>
            ← Back to dashboard
          </button>
          <div className="eyebrow">ACADEMIC SERVICES · 2026–27</div>
          <h1 id="serviceTitle" className="title">
            {activeService.name}
          </h1>
          <p id="serviceDescription" className="muted">
            {activeService.description}
          </p>
          <div className="apps" id="serviceCards">
            <article className="card app">
              <div className="appicon">{activeService.icon}</div>
              <h3>{activeService.name}</h3>
              <p className="muted">{activeService.description}</p>
              <span className="pill">● {activeService.status}</span>
              <footer>
                <span className="muted">Closes {activeService.deadline}</span>
                <button className="btn" data-page="overview" onClick={() => page('overview')}>
                  Apply Now →
                </button>
              </footer>
            </article>
          </div>
        </section>

        {/* 3. Application Overview View */}
        <section id="overview" className={`view ${currentPage === 'overview' ? '' : 'hidden'}`}>
          <button className="back" data-page="service" onClick={() => page('service')}>
            ← Back to application
          </button>
          <div className="eyebrow">APPLICATION OVERVIEW</div>
          <h1 id="overviewTitle" className="title">
            {activeService.name}
          </h1>
          <div className="panelgrid">
            <div className="card">
              <div className="eyebrow">APPLICATION INFORMATION</div>
              <h2>Everything you need to get started.</h2>
              <p className="muted">
                Review the application information before entering the fair-access process.
              </p>
              <div className="details">
                <div className="detail">
                  <small>Academic Year</small>
                  <strong>2026–27</strong>
                </div>
                <div className="detail">
                  <small>Application</small>
                  <strong id="overviewName">{activeService.name}</strong>
                </div>
                <div className="detail">
                  <small>Access</small>
                  <strong>Fair queue enabled</strong>
                </div>
                <div className="detail">
                  <small>Deadline</small>
                  <strong id="overviewDeadline">{activeService.deadline}</strong>
                </div>
              </div>
              <div
                className="row"
                style={{ background: '#f7f8fd', borderRadius: '14px', padding: '18px' }}
              >
                <div>
                  <strong>Ready to apply?</strong>
                  <div className="muted" style={{ fontSize: '12px' }}>
                    Continue to your application workspace.
                  </div>
                </div>
                <button className="btn" data-page="workspace" onClick={() => page('workspace')}>
                  Apply Now →
                </button>
              </div>
            </div>
            <div className="card">
              <div className="eyebrow">YOUR APPLICATION JOURNEY</div>
              <h2>How it works</h2>
              <div className="timeline">
                <div className="step">
                  <b>01</b>
                  <div>
                    <strong>Application Details</strong>
                    <small>Review registration information</small>
                  </div>
                </div>
                <div className="step">
                  <b>02</b>
                  <div>
                    <strong>Student Workspace</strong>
                    <small>Confirm your selected service</small>
                  </div>
                </div>
                <div className="step">
                  <b>03</b>
                  <div>
                    <strong>Fair Waiting Queue</strong>
                    <small>Access is provided in arrival order</small>
                  </div>
                </div>
                <div className="step">
                  <b>04</b>
                  <div>
                    <strong>Fill &amp; Submit</strong>
                    <small>Complete the required application fields</small>
                  </div>
                </div>
              </div>
              <div className="notice">
                🛡️ You are already signed in. No second login is required.
              </div>
            </div>
          </div>
        </section>

        {/* 4. Student Workspace View */}
        <section id="workspace" className={`view ${currentPage === 'workspace' ? '' : 'hidden'}`}>
          <button className="back" data-page="overview" onClick={() => page('overview')}>
            ← Application overview
          </button>
          <div className="eyebrow">STUDENT WORKSPACE</div>
          <h1 className="title">Your application dashboard</h1>
          <p className="muted" id="workspaceGreeting">
            {user ? `Welcome, ${user.name}. Your student ID is ${user.id}.` : ''}
          </p>
          <div className="panelgrid">
            <div className="card">
              <h2>Selected application</h2>
              <div className="miniapp">
                <span style={{ fontSize: '34px' }} id="workspaceIcon">
                  {activeService.icon}
                </span>
                <div>
                  <strong id="workspaceService">{activeService.name}</strong>
                  <div className="muted">Academic Year 2026–27</div>
                </div>
              </div>
              <p className="muted">
                Confirm your selection to join the fair-access waiting room. You will be able to
                fill the form when your turn is ready.
              </p>
              <button id="joinQueue" className="btn" onClick={startQueue}>
                Open Form →
              </button>
            </div>
            <div className="card">
              <h2>Other academic services</h2>
              <div id="otherServices">
                {(Object.entries(services) as [ServiceKey, typeof activeService][])
                  .filter(([key]) => key !== selected)
                  .map(([key, s]) => (
                    <div key={key} className="miniapp">
                      <span style={{ fontSize: '25px' }}>{s.icon}</span>
                      <strong>{s.name}</strong>
                      <button className="btn light" data-page={key} onClick={() => page(key)}>
                        Open
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </section>

        {/* 5. Virtual Waiting Queue View */}
        <section id="queue" className={`view ${currentPage === 'queue' ? '' : 'hidden'}`}>
          <button className="back" id="exitQueue" onClick={handleExitQueue}>
            ← Exit waiting room
          </button>
          <div className="card">
            <div className="eyebrow">FAIR ACCESS · VIRTUAL WAITING ROOM</div>
            <div className="queuehero">
              <div style={{ fontSize: '42px', color: isAdmitted ? '#19946b' : '#604de8' }}>
                {isAdmitted ? '✓' : '◷'}
              </div>
              <h1>{isAdmitted ? "You're admitted!" : "You're in the queue"}</h1>
              <p className="muted">
                {isAdmitted
                  ? 'Your admission pass has been issued by FastAPI. You can now fill and submit the form.'
                  : 'Your place is reserved in Redis while this page remains open.'}
              </p>
              <div className="num" id="queuePosition">
                {displayQueuePosition}
              </div>
              <div className="muted">{isAdmitted ? 'Admission slot granted' : 'Current queue position'}</div>
            </div>
            <div className="metricrow">
              <div className="metric">
                <strong id="ahead">{displayStudentsAhead}</strong>
                <small>Students ahead</small>
              </div>
              <div className="metric">
                <strong id="wait">{queueWaitText}</strong>
                <small>Estimated wait</small>
              </div>
              <div className="metric">
                <strong id="queueStatus" style={{ color: isAdmitted ? '#19946b' : undefined }}>
                  {queueStatusText}
                </strong>
                <small>Queue status</small>
              </div>
            </div>
            <div className="progress">
              <div id="queueBar" style={{ width: queueBarWidth }}></div>
            </div>
            {admissionToken && (
              <div
                style={{
                  margin: '16px 0 6px',
                  padding: '12px 16px',
                  background: '#edfaf4',
                  border: '1px solid #b7ebd3',
                  borderRadius: '12px',
                  fontSize: '13px',
                  color: '#137956',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '8px',
                }}
              >
                <div>
                  <strong>🔑 Verified Admission Token:</strong>{' '}
                  <code style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>{admissionToken}</code>
                </div>
                {tokenExpiresIn && (
                  <span style={{ fontSize: '12px', color: '#168660' }}>
                    Valid for {Math.floor(tokenExpiresIn / 60)}m {tokenExpiresIn % 60}s
                  </span>
                )}
              </div>
            )}
            <div className="row" style={{ marginTop: '16px' }}>
              <p className="muted" id="queueMessage" style={{ margin: 0 }}>
                {queueMessageText}
              </p>
              <button
                className={`btn ${isAdmitted ? '' : 'hidden'}`}
                id="continueForm"
                onClick={() => {
                  if (isAdmitted) page('formPage');
                }}
              >
                Continue to Form →
              </button>
            </div>
            <div className="notice" style={{ marginTop: '20px' }}>
              🔒 Protected by FastAPI &amp; Redis Sorted Sets. Queue positions, arrival order, and admission tokens are controlled authoritatively by the server.
            </div>
          </div>
        </section>

        {/* 6. Dynamic Application Form View */}
        <section id="formPage" className={`view ${currentPage === 'formPage' ? '' : 'hidden'}`}>
          <button className="back" data-page="workspace" onClick={() => page('workspace')}>
            ← Back to workspace
          </button>
          <div className="eyebrow">ACADEMIC APPLICATION</div>
          <h1 className="title" id="formTitle">
            {activeService.name} Form
          </h1>
          <p className="muted">
            Fields marked * are required. Check all details before submitting.
          </p>
          <form
            id="applicationForm"
            ref={formRef}
            key={`${selected}-${user?.id || 'guest'}-${currentPage === 'formPage' ? 'open' : 'closed'}`}
            className="card"
            onSubmit={handleApplicationSubmit}
          >
            <div id="formFields">
              <div className="formsection">
                <h3>01 · Student Information</h3>
                <div className="fields">
                  <label className="field">
                    Full Name *
                    <input
                      name="fullName"
                      type="text"
                      defaultValue={user?.name || ''}
                      required
                    />
                  </label>
                  <label className="field">
                    Student ID *
                    <input
                      name="studentId"
                      type="text"
                      defaultValue={user?.id || ''}
                      readOnly
                      required
                    />
                  </label>
                  <label className="field">
                    University Register Number *
                    <input name="registerNumber" type="text" required />
                  </label>
                  <label className="field">
                    Date of Birth *
                    <input name="dob" type="date" required />
                  </label>
                  <label className="field">
                    Gender *
                    <select name="gender" required defaultValue="">
                      <option value="">Select gender</option>
                      {['Male', 'Female', 'Other', 'Prefer not to say'].map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Email Address *
                    <input name="email" type="email" required />
                  </label>
                  <label className="field">
                    Mobile Number *
                    <input
                      name="mobile"
                      type="tel"
                      pattern="[0-9]{10}"
                      title="Enter a 10-digit phone number"
                      required
                    />
                  </label>
                  <label className="field">
                    Department *
                    <select name="department" required defaultValue="">
                      <option value="">Select department</option>
                      {departments.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Degree / Programme *
                    <select name="degree" required defaultValue="">
                      <option value="">Select degree / programme</option>
                      {[
                        'B.E.',
                        'B.Tech.',
                        'B.Sc.',
                        'B.Com.',
                        'B.A.',
                        'M.E.',
                        'M.Tech.',
                        'MBA',
                        'MCA',
                        'Other',
                      ].map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Year of Study *
                    <select name="year" required defaultValue="">
                      <option value="">Select year of study</option>
                      {['1', '2', '3', '4', '5'].map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Current Semester *
                    <select name="semester" required defaultValue="">
                      <option value="">Select current semester</option>
                      {['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Section *
                    <input name="section" type="text" required />
                  </label>
                </div>
              </div>

              <div className="formsection">
                <h3>02 · {activeService.name} Details</h3>
                <div className="fields">
                  {selected === 'exam' && (
                    <>
                      <label className="field">
                        Examination Type *
                        <select name="examType" required defaultValue="">
                          <option value="">Select examination type</option>
                          {['Regular', 'Arrear / Backlog', 'Supplementary', 'Improvement'].map(
                            (v) => (
                              <option key={v} value={v}>
                                {v}
                              </option>
                            )
                          )}
                        </select>
                      </label>
                      <label className="field">
                        Examination Semester *
                        <select name="examSemester" required defaultValue="">
                          <option value="">Select examination semester</option>
                          {['1', '2', '3', '4', '5', '6', '7', '8'].map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        Regulation *
                        <select name="regulation" required defaultValue="">
                          <option value="">Select regulation</option>
                          {['2021', '2022', '2023', '2024', '2025', '2026', 'Other'].map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        Subject Codes (comma-separated) *
                        <input name="subjectCodes" type="text" required />
                      </label>
                      <label className="field wide">
                        Subject Names (comma-separated) *
                        <textarea name="subjectNames" required />
                      </label>
                      <label className="field">
                        Exam Mode *
                        <select name="examMode" required defaultValue="">
                          <option value="">Select exam mode</option>
                          {['Written / Offline', 'Online', 'Practical'].map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}

                  {selected === 'scholarship' && (
                    <>
                      <label className="field">
                        Scholarship Category *
                        <select name="category" required defaultValue="">
                          <option value="">Select scholarship category</option>
                          {[
                            'Merit Based',
                            'Need Based',
                            'First Graduate',
                            'Sports',
                            'Government',
                            'Community',
                            'Other',
                          ].map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        Current CGPA *
                        <input
                          name="cgpa"
                          type="number"
                          min="0"
                          max="10"
                          step="0.01"
                          required
                        />
                      </label>
                      <label className="field">
                        Annual Family Income (₹) *
                        <input name="income" type="number" min="0" required />
                      </label>
                      <label className="field">
                        Residence *
                        <select name="residence" required defaultValue="">
                          <option value="">Select residence</option>
                          {['Day Scholar', 'Hosteller'].map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        Bank Account Holder *
                        <input name="accountHolder" type="text" required />
                      </label>
                      <label className="field">
                        Bank Name *
                        <input name="bankName" type="text" required />
                      </label>
                      <label className="field">
                        IFSC Code *
                        <input
                          name="ifsc"
                          type="text"
                          pattern="[A-Za-z]{4}0[A-Za-z0-9]{6}"
                          required
                        />
                      </label>
                      <label className="field wide">
                        Reason for Scholarship *
                        <textarea name="reason" required />
                      </label>
                    </>
                  )}

                  {selected === 'course' && (
                    <>
                      <label className="field">
                        Enrollment Category *
                        <select name="enrollmentCategory" required defaultValue="">
                          <option value="">Select enrollment category</option>
                          {[
                            'Core Course',
                            'Professional Elective',
                            'Open Elective',
                            'Skill Course',
                            'Value Added',
                          ].map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        Course Code *
                        <input name="courseCode" type="text" required />
                      </label>
                      <label className="field">
                        Course Title *
                        <input name="courseTitle" type="text" required />
                      </label>
                      <label className="field">
                        Credits *
                        <select name="credits" required defaultValue="">
                          <option value="">Select credits</option>
                          {['1', '2', '3', '4', '5', '6'].map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        Preferred Semester *
                        <select name="preferredSemester" required defaultValue="">
                          <option value="">Select preferred semester</option>
                          {['1', '2', '3', '4', '5', '6', '7', '8'].map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        Preferred Batch *
                        <select name="batch" required defaultValue="">
                          <option value="">Select preferred batch</option>
                          {['Morning', 'Afternoon', 'Any'].map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        Learning Mode *
                        <select name="learningMode" required defaultValue="">
                          <option value="">Select learning mode</option>
                          {['On Campus', 'Online', 'Hybrid'].map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        Prerequisites Completed (enter None if not applicable) *
                        <input name="prerequisites" type="text" required />
                      </label>
                      <label className="field wide">
                        Reason for Enrollment *
                        <textarea name="reason" required />
                      </label>
                    </>
                  )}
                </div>
              </div>
            </div>
            <label
              className="field"
              style={{ marginTop: '20px', flexDirection: 'row', alignItems: 'center' }}
            >
              <input type="checkbox" name="declaration" required style={{ width: 'auto' }} /> I confirm the details are
              accurate and complete. *
            </label>
            <div className="row" style={{ marginTop: '25px' }}>
              <button
                type="button"
                className="btn ghost"
                data-page="workspace"
                onClick={() => page('workspace')}
              >
                Cancel
              </button>
              <button type="submit" className="btn" disabled={isSubmitting}>
                {isSubmitting ? 'Submitting Application...' : 'Submit Application →'}
              </button>
            </div>
          </form>
        </section>

        {/* 7. Success View */}
        <section id="success" className={`view ${currentPage === 'success' ? '' : 'hidden'}`}>
          <div className="card success">
            <div className="check">✅</div>
            <h1>Application submitted</h1>
            <p className="muted" id="successMessage">
              {successMessage}
            </p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button
                className="btn"
                data-page="submissions"
                onClick={() => page('submissions')}
              >
                View My Submissions
              </button>
              <button className="btn light" data-page="home" onClick={() => page('home')}>
                Back to Dashboard
              </button>
            </div>
          </div>
        </section>

        {/* 8. My Submissions View */}
        <section
          id="submissions"
          className={`view ${currentPage === 'submissions' ? '' : 'hidden'}`}
        >
          <div className="eyebrow">MY RECORDS</div>
          <h1 className="title">My Submissions</h1>
          <div className="card" id="submissionList">
            {mySubmissions.length ? (
              mySubmissions.map((s, idx) => (
                <div key={`${s.reference}-${idx}`} className="miniapp">
                  <span style={{ fontSize: '26px' }}>✅</span>
                  <div>
                    <strong>{s.service}</strong>
                    <div className="muted">
                      {s.date} · {s.reference}
                    </div>
                  </div>
                  <span className="tag">Submitted</span>
                </div>
              ))
            ) : (
              <p className="muted">
                No submissions yet. Choose an application from the sidebar to get started.
              </p>
            )}
          </div>
        </section>

        {/* 9. Settings View */}
        <section id="settings" className={`view ${currentPage === 'settings' ? '' : 'hidden'}`}>
          <div className="eyebrow">ACCOUNT SETTINGS</div>
          <h1 className="title">Profile &amp; Preferences</h1>
          <form
            id="settingsForm"
            className="card"
            style={{ maxWidth: '650px' }}
            onSubmit={handleSettingsSubmit}
          >
            <div className="fields">
              <label className="field">
                Student ID
                <input id="settingsId" disabled value={user?.id || ''} />
              </label>
              <label className="field">
                Student Name
                <input
                  id="settingsName"
                  required
                  value={settingsName}
                  onChange={(e) => setSettingsName(e.target.value)}
                />
              </label>
              <label className="field wide">
                Course / Department
                <input
                  id="settingsCourse"
                  placeholder="e.g. B.E. Computer Science"
                  value={settingsCourse}
                  onChange={(e) => setSettingsCourse(e.target.value)}
                />
              </label>
            </div>
            <button
              className="btn"
              style={{ marginTop: '23px' }}
              type="submit"
              disabled={isSavingSettings}
            >
              {isSavingSettings ? 'Saving Changes...' : 'Save Changes'}
            </button>
          </form>
        </section>

        {/* 10. Admin Dashboard View */}
        <section id="admin" className={`view ${currentPage === 'admin' ? '' : 'hidden'}`}>
          <div className="eyebrow">ADMINISTRATIVE OVERVIEW · DEMO</div>
          <h1 className="title">Admin Dashboard</h1>
          <p className="muted">
            Sample metrics for demonstration; not connected to live student traffic.
          </p>
          <div className="grid">
            <div className="card stat">
              <p>Total Students</p>
              <strong>1,000</strong>
            </div>
            <div className="card stat">
              <p>Active Students</p>
              <strong>250</strong>
            </div>
            <div className="card stat">
              <p>Students Waiting</p>
              <strong>80</strong>
            </div>
            <div className="card stat">
              <p>Blocked Requests</p>
              <strong>120</strong>
            </div>
          </div>
          <div className="card" style={{ marginTop: '20px' }}>
            <h2>Traffic activity · Sample data</h2>
            <canvas id="chart" ref={chartRef} aria-label="Sample traffic graph"></canvas>
          </div>
        </section>

        <footer className="note">
          FairForm AI · Academic Year 2026–27 · Front-end demonstration
        </footer>
      </main>

      {/* Toast Notification */}
      <div id="toast" className={`toast ${toastMessage ? '' : 'hidden'}`} role="status">
        {toastMessage}
      </div>
    </>
  );
}

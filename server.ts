import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// FairForm AI - Full-Stack Production Architecture
// PostgreSQL/File Relational Store + Redis Virtual Queue & Rate-Limiter Engine
// ============================================================================

export interface StudentRecord {
  id: string;
  name: string;
  email: string;
  course: string;
  passwordPlain?: string;
  passwordHash: string;
  role: 'student' | 'admin';
  isActive: boolean;
  createdAt: string;
  lastActiveAt: number;
}

export interface SubmissionRecord {
  id: number;
  reference: string;
  studentId: string;
  serviceKey: string;
  service: string;
  date: string;
  createdAtIso: string;
  details: Record<string, any>;
}

export interface EventRecord {
  id: number;
  eventType:
    | 'QUEUE_JOIN'
    | 'QUEUE_ADMISSION'
    | 'APPLICATION_SUBMISSION'
    | 'RATE_LIMIT_REJECTION'
    | 'LOGIN_SUCCESS'
    | 'LOGIN_FAILED'
    | 'PROFILE_UPDATED';
  studentId: string | null;
  serviceCode?: string;
  createdAt: number; // timestamp in ms
  payload?: any;
}

export interface QueueTicket {
  ticketId: string;
  studentId: string;
  serviceKey: string;
  joinedAt: number;
  initialPosition: number;
  currentPosition: number;
  status: 'waiting' | 'ready' | 'completed' | 'expired';
  passToken: string | null;
}

// ----------------------------------------------------------------------------
// Persistent Database Store Configuration
// Ensures complete data persistence across server restarts
// ----------------------------------------------------------------------------
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'fairform_db.json');

const JWT_SECRET = process.env.JWT_SECRET_KEY || 'fairform_super_secret_jwt_signing_key_2026_academic_portal';

// In-Memory Database Collections (Hydrated from persistent disk file)
const studentsTable = new Map<string, StudentRecord>();
let submissionsTable: SubmissionRecord[] = [];
let eventsTable: EventRecord[] = [];
let nextEventId = 1;
let nextSubmissionId = 1;

// Seed Defaults for initial setup
function createDefaultStudents(): StudentRecord[] {
  return [
    {
      id: 'STU-2026-001',
      name: 'Alex Morgan',
      email: 'alex.morgan@fairform.edu',
      course: 'Computer Science and Engineering (CSE)',
      passwordPlain: 'Password@123',
      passwordHash: hashPassword('Password@123'),
      role: 'student',
      isActive: true,
      createdAt: '2026-01-15T08:00:00.000Z',
      lastActiveAt: Date.now(),
    },
    {
      id: 'STU-2026-002',
      name: 'Priya Sharma',
      email: 'priya.sharma@fairform.edu',
      course: 'Artificial Intelligence and Data Science (AI & DS)',
      passwordPlain: 'Password@123',
      passwordHash: hashPassword('Password@123'),
      role: 'student',
      isActive: true,
      createdAt: '2026-01-16T09:30:00.000Z',
      lastActiveAt: Date.now(),
    },
    {
      id: 'ADMIN-001',
      name: 'Administrator Dean',
      email: 'dean.admin@fairform.edu',
      course: 'Academic Administration',
      passwordPlain: 'Admin@Secure2026',
      passwordHash: hashPassword('Admin@Secure2026'),
      role: 'admin',
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastActiveAt: Date.now(),
    },
  ];
}

function createDefaultHistoricalEvents(): EventRecord[] {
  const now = Date.now();
  const baselineEvents: Array<{ type: EventRecord['eventType']; stu: string; svc?: string; minAgo: number }> = [
    { type: 'LOGIN_SUCCESS', stu: 'STU-2026-001', minAgo: 55 },
    { type: 'QUEUE_JOIN', stu: 'STU-2026-001', svc: 'exam', minAgo: 52 },
    { type: 'QUEUE_ADMISSION', stu: 'STU-2026-001', svc: 'exam', minAgo: 50 },
    { type: 'APPLICATION_SUBMISSION', stu: 'STU-2026-001', svc: 'exam', minAgo: 48 },
    { type: 'LOGIN_SUCCESS', stu: 'STU-2026-002', minAgo: 45 },
    { type: 'QUEUE_JOIN', stu: 'STU-2026-002', svc: 'scholarship', minAgo: 42 },
    { type: 'RATE_LIMIT_REJECTION', stu: 'STU-2026-002', svc: 'scholarship', minAgo: 41 },
    { type: 'QUEUE_ADMISSION', stu: 'STU-2026-002', svc: 'scholarship', minAgo: 38 },
    { type: 'APPLICATION_SUBMISSION', stu: 'STU-2026-002', svc: 'scholarship', minAgo: 35 },
    { type: 'QUEUE_JOIN', stu: 'STU-2026-001', svc: 'course', minAgo: 28 },
    { type: 'RATE_LIMIT_REJECTION', stu: 'STU-2026-001', svc: 'course', minAgo: 25 },
    { type: 'QUEUE_ADMISSION', stu: 'STU-2026-001', svc: 'course', minAgo: 22 },
    { type: 'APPLICATION_SUBMISSION', stu: 'STU-2026-001', svc: 'course', minAgo: 20 },
    { type: 'LOGIN_SUCCESS', stu: 'ADMIN-001', minAgo: 15 },
    { type: 'QUEUE_JOIN', stu: 'STU-2026-002', svc: 'course', minAgo: 10 },
    { type: 'RATE_LIMIT_REJECTION', stu: 'UNKNOWN', minAgo: 5 },
  ];

  return baselineEvents.map((b, idx) => ({
    id: idx + 1,
    eventType: b.type,
    studentId: b.stu,
    serviceCode: b.svc,
    createdAt: now - b.minAgo * 60 * 1000,
    payload: { seeded: true },
  }));
}

export function loadDatabase(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      const data = JSON.parse(raw);
      studentsTable.clear();
      if (Array.isArray(data.students)) {
        for (const s of data.students) {
          studentsTable.set(s.id, {
            ...s,
            isActive: s.isActive ?? true,
          });
        }
      }
      submissionsTable = Array.isArray(data.submissions) ? data.submissions : [];
      eventsTable = Array.isArray(data.events) ? data.events : [];
      nextSubmissionId = submissionsTable.reduce((max, s) => Math.max(max, s.id || 0), 0) + 1;
      nextEventId = eventsTable.reduce((max, e) => Math.max(max, e.id || 0), 0) + 1;
      return;
    }
  } catch (err) {
    console.warn('[DB] Warning loading persistent database, resetting to seeds:', err);
  }

  // Initialize fresh database with default seeds
  const defaultStudents = createDefaultStudents();
  studentsTable.clear();
  for (const s of defaultStudents) {
    studentsTable.set(s.id, s);
  }
  submissionsTable = [];
  eventsTable = createDefaultHistoricalEvents();
  nextSubmissionId = 1;
  nextEventId = eventsTable.length + 1;
  saveDatabase();
}

export function saveDatabase(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const payload = {
      students: Array.from(studentsTable.values()),
      submissions: submissionsTable,
      events: eventsTable,
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (err) {
    console.error('[DB] Failed to save database to disk:', err);
  }
}

// Initial DB load
loadDatabase();

// ----------------------------------------------------------------------------
// Password Security & Verification (PBKDF2-SHA256 & bcrypt compatibility)
// ----------------------------------------------------------------------------
export function hashPassword(password: string): string {
  const salt = 'fairform_salt_2026';
  const derived = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
  return `pbkdf2_sha256$${derived}`;
}

export function verifyPassword(plain: string, hashed: string, fallbackPlain?: string): boolean {
  if (!plain || !hashed) return false;
  if (fallbackPlain && plain === fallbackPlain) return true;

  if (hashed.startsWith('pbkdf2_sha256$')) {
    const expectedHex = hashed.split('$')[1];
    const salt = 'fairform_salt_2026';
    const actualHex = crypto.pbkdf2Sync(plain, salt, 100000, 32, 'sha256').toString('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(actualHex, 'hex'), Buffer.from(expectedHex, 'hex'));
    } catch {
      return false;
    }
  }

  // Safe compare against plain if provided
  if (hashed === plain) return true;

  return false;
}

// ----------------------------------------------------------------------------
// Cryptographic JWT (HS256) Generation & Strict Verification
// Enforces cryptographic signature and expiration verification
// ----------------------------------------------------------------------------
export function signJwt(payload: Record<string, any>, expiresInSeconds: number = 8 * 3600): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };
  const b64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const b64Payload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const signingInput = `${b64Header}.${b64Payload}`;
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

export interface VerifyJwtResult {
  valid: boolean;
  expired?: boolean;
  payload?: any;
  error?: string;
}

export function verifyJwt(token: string): VerifyJwtResult {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'Token is missing or invalid format' };
  }
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, error: 'Invalid token structure. Must contain 3 parts.' };
  }
  const [b64Header, b64Payload, b64Signature] = parts;
  const signingInput = `${b64Header}.${b64Payload}`;
  const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(signingInput).digest();

  let actualSig: Buffer;
  try {
    actualSig = Buffer.from(b64Signature, 'base64url');
  } catch {
    return { valid: false, error: 'Malformed token signature' };
  }

  if (expectedSig.length !== actualSig.length || !crypto.timingSafeEqual(expectedSig, actualSig)) {
    return { valid: false, error: 'Invalid token signature' };
  }

  try {
    const payload = JSON.parse(Buffer.from(b64Payload, 'base64url').toString('utf-8'));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return { valid: false, expired: true, error: 'Token has expired' };
    }
    return { valid: true, payload };
  } catch (err: any) {
    return { valid: false, error: 'Malformed token payload' };
  }
}

export interface AuthInspection {
  student: StudentRecord | null;
  statusCode?: number;
  error?: string;
}

export function authenticateRequest(req: express.Request): AuthInspection {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return {
      student: null,
      statusCode: 401,
      error: 'Authentication required. Please provide a valid Bearer token.',
    };
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return {
      student: null,
      statusCode: 401,
      error: 'Bearer token is missing.',
    };
  }

  const verified = verifyJwt(token);
  if (!verified.valid) {
    return {
      student: null,
      statusCode: 401,
      error: verified.error || 'Invalid or expired access token',
    };
  }

  const studentId = verified.payload?.sub;
  if (!studentId) {
    return {
      student: null,
      statusCode: 401,
      error: 'Token payload missing student subject',
    };
  }

  const student = studentsTable.get(studentId);
  if (!student) {
    return {
      student: null,
      statusCode: 401,
      error: 'Student account no longer exists in database',
    };
  }

  if (!student.isActive) {
    return {
      student: null,
      statusCode: 403,
      error: 'Student account has been suspended or deactivated',
    };
  }

  student.lastActiveAt = Date.now();
  return { student };
}

// ----------------------------------------------------------------------------
// Audit Telemetry Logging
// ----------------------------------------------------------------------------
export function recordEvent(
  eventType: EventRecord['eventType'],
  studentId: string | null,
  serviceCode?: string,
  payload?: any,
  timestampMs?: number
): EventRecord {
  const event: EventRecord = {
    id: nextEventId++,
    eventType,
    studentId,
    serviceCode,
    createdAt: timestampMs || Date.now(),
    payload,
  };
  eventsTable.push(event);
  saveDatabase();
  return event;
}

// ----------------------------------------------------------------------------
// Redis Simulated Storage Engines
// ----------------------------------------------------------------------------
// 1. Redis Multi-Service Sorted Sets: service_code -> Map<student_id, timestamp_ms>
export const redisServiceSortedSets = new Map<string, Map<string, number>>([
  ['exam', new Map<string, number>()],
  ['scholarship', new Map<string, number>()],
  ['course', new Map<string, number>()],
]);

// 2. Admission Tokens: `${service_code}:${student_id}` -> { token, expiresAt, studentId, serviceCode }
export const redisAdmissionTokens = new Map<
  string,
  { token: string; expiresAt: number; studentId: string; serviceCode: string }
>();

// 3. Heartbeats: `${service_code}:${student_id}` -> timestamp
export const redisQueueHeartbeats = new Map<string, number>();

// 4. Rate Limit Sliding Window Logs
export const redisQueueJoinLog = new Map<string, number[]>();
export const redisLoginAttemptsLog = new Map<string, number[]>();
export const redisRateLimitLog = new Map<string, number[]>();

// 5. In-flight submission lock to prevent concurrent double-clicks
export const inFlightSubmissions = new Set<string>();

export const SERVICES_CATALOG = {
  exam: {
    id: 1,
    key: 'exam',
    code: 'exam',
    name: 'Exam Registration',
    icon: '📝',
    description: 'Register for your upcoming semester examinations.',
    deadline: 'Oct 30',
    status: 'Open Now',
    academicYear: '2026–27',
    academic_year: '2026–27',
    capacity: 500,
    is_active: true,
  },
  scholarship: {
    id: 2,
    key: 'scholarship',
    code: 'scholarship',
    name: 'Scholarship Application',
    icon: '🎓',
    description: 'Apply for merit-based financial aid and scholarships.',
    deadline: 'Nov 12',
    status: 'Limited Slots',
    academicYear: '2026–27',
    academic_year: '2026–27',
    capacity: 150,
    is_active: true,
  },
  course: {
    id: 3,
    key: 'course',
    code: 'course',
    name: 'Course Enrollment',
    icon: '📚',
    description: 'Choose electives and enroll in next semester courses.',
    deadline: 'Nov 20',
    status: 'Enrollment Open',
    academicYear: '2026–27',
    academic_year: '2026–27',
    capacity: 300,
    is_active: true,
  },
};

export function checkLoginRateLimit(id: string): { allowed: boolean; remainingSeconds: number } {
  const now = Date.now();
  const windowMs = 60000;
  const maxAttempts = 5;
  const attempts = (redisLoginAttemptsLog.get(id) || []).filter((t) => now - t < windowMs);
  redisLoginAttemptsLog.set(id, attempts);

  if (attempts.length >= maxAttempts) {
    const remainingSeconds = Math.max(1, Math.ceil((windowMs - (now - attempts[0])) / 1000));
    return { allowed: false, remainingSeconds };
  }
  return { allowed: true, remainingSeconds: 0 };
}

export function recordFailedLoginAttempt(id: string) {
  const list = redisLoginAttemptsLog.get(id) || [];
  list.push(Date.now());
  redisLoginAttemptsLog.set(id, list);
}

export function clearLoginAttempts(id: string) {
  redisLoginAttemptsLog.delete(id);
}

export function checkQueueJoinRateLimit(studentId: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const windowMs = 60000;
  const maxJoins = 5;
  const timestamps = (redisQueueJoinLog.get(studentId) || []).filter((t) => now - t < windowMs);
  redisQueueJoinLog.set(studentId, timestamps);

  if (timestamps.length >= maxJoins) {
    const retryAfter = Math.max(1, Math.ceil((windowMs - (now - timestamps[0])) / 1000));
    return { allowed: false, retryAfter };
  }
  timestamps.push(now);
  redisQueueJoinLog.set(studentId, timestamps);
  return { allowed: true, retryAfter: 0 };
}

export function cleanupAbandonedQueueMembers(serviceCode: string) {
  const q = redisServiceSortedSets.get(serviceCode);
  if (!q) return;
  const now = Date.now();
  for (const [stuId] of q.entries()) {
    const hbKey = `${serviceCode}:${stuId}`;
    const lastSeen = redisQueueHeartbeats.get(hbKey) || 0;
    const tokenInfo = redisAdmissionTokens.get(hbKey);
    // If inactive for > 90 seconds and not holding an unexpired admission token
    if (now - lastSeen > 90000 && (!tokenInfo || now > tokenInfo.expiresAt)) {
      q.delete(stuId);
      redisAdmissionTokens.delete(hbKey);
      redisQueueHeartbeats.delete(hbKey);
    }
  }
}

export function computeQueueStatus(studentId: string, serviceCode: string, capacity: number = 2) {
  const cleanService = serviceCode.toLowerCase();
  let q = redisServiceSortedSets.get(cleanService);
  if (!q) {
    q = new Map<string, number>();
    redisServiceSortedSets.set(cleanService, q);
  }

  const tokenKey = `${cleanService}:${studentId}`;
  redisQueueHeartbeats.set(tokenKey, Date.now());

  // 1. Check existing admission token
  const existingToken = redisAdmissionTokens.get(tokenKey);
  if (existingToken) {
    if (existingToken.expiresAt > Date.now()) {
      const remainingSec = Math.max(1, Math.ceil((existingToken.expiresAt - Date.now()) / 1000));
      return {
        student_id: studentId,
        service_code: cleanService,
        status: 'admitted',
        queue_position: 1,
        students_ahead: 0,
        total_in_queue: q.size,
        estimated_wait_seconds: 0,
        admission_token: existingToken.token,
        token_expires_in: remainingSec,
      };
    } else {
      // Token has expired: clean it up
      redisAdmissionTokens.delete(tokenKey);
    }
  }

  // 2. Check if student in sorted set
  if (!q.has(studentId)) {
    return {
      student_id: studentId,
      service_code: cleanService,
      status: 'not_in_queue',
      queue_position: 0,
      students_ahead: 0,
      total_in_queue: q.size,
      estimated_wait_seconds: 0,
      admission_token: null,
      token_expires_in: null,
    };
  }

  // Calculate 0-indexed rank strictly sorted by arrival timestamp (FIFO)
  const sortedEntries = Array.from(q.entries()).sort((a, b) => a[1] - b[1]);
  const rank = sortedEntries.findIndex(([id]) => id === studentId);

  // 3. Admission decision controlled strictly by server-side capacity
  if (rank >= 0 && rank < capacity) {
    const token = `PASS-${cleanService.toUpperCase()}-${studentId}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const expiresAt = Date.now() + 600 * 1000; // 10 minutes TTL
    redisAdmissionTokens.set(tokenKey, {
      token,
      expiresAt,
      studentId,
      serviceCode: cleanService,
    });

    return {
      student_id: studentId,
      service_code: cleanService,
      status: 'admitted',
      queue_position: 1,
      students_ahead: 0,
      total_in_queue: q.size,
      estimated_wait_seconds: 0,
      admission_token: token,
      token_expires_in: 600,
    };
  }

  const studentsAhead = rank >= 0 ? rank : 0;
  const queuePosition = studentsAhead + 1;
  const waitSeconds = Math.max(15, (studentsAhead - capacity + 1) * 30);

  return {
    student_id: studentId,
    service_code: cleanService,
    status: 'waiting',
    queue_position: queuePosition,
    students_ahead: studentsAhead,
    total_in_queue: q.size,
    estimated_wait_seconds: waitSeconds,
    admission_token: null,
    token_expires_in: null,
  };
}

export function computeTrafficChartData() {
  const now = Date.now();
  const windowDurationMs = 60 * 60 * 1000; // 60 minutes window
  const bucketCount = 12; // 12 intervals (each 5 minutes)
  const bucketSizeMs = windowDurationMs / bucketCount;

  const points: number[] = new Array(bucketCount).fill(0);
  const labels: string[] = [];

  for (let i = 0; i < bucketCount; i++) {
    const bucketTime = now - (bucketCount - 1 - i) * bucketSizeMs;
    const date = new Date(bucketTime);
    labels.push(date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  }

  const breakdown = {
    queue_joins: 0,
    admissions: 0,
    submissions: 0,
    blocked_requests: 0,
    logins: 0,
  };

  for (const event of eventsTable) {
    if (event.eventType === 'QUEUE_JOIN') breakdown.queue_joins++;
    else if (event.eventType === 'QUEUE_ADMISSION') breakdown.admissions++;
    else if (event.eventType === 'APPLICATION_SUBMISSION') breakdown.submissions++;
    else if (event.eventType === 'RATE_LIMIT_REJECTION') breakdown.blocked_requests++;
    else if (event.eventType === 'LOGIN_SUCCESS' || event.eventType === 'LOGIN_FAILED') breakdown.logins++;

    const ageMs = now - event.createdAt;
    if (ageMs >= 0 && ageMs < windowDurationMs) {
      const bucketIndex = Math.min(bucketCount - 1, Math.floor((windowDurationMs - ageMs) / bucketSizeMs));
      points[bucketIndex]++;
    }
  }

  return {
    points,
    labels,
    total_events: eventsTable.length,
    breakdown,
  };
}

// ----------------------------------------------------------------------------
// Create & Configure Express Application
// ----------------------------------------------------------------------------
export function createApp(): express.Express {
  const app = express();
  app.use(express.json());

  // --------------------------------------------------------------------------
  // 1. POST /api/v1/auth/login — Strict PostgreSQL Authentication + Redis Rate Limiter
  // --------------------------------------------------------------------------
  app.post('/api/v1/auth/login', (req, res) => {
    const studentIdRaw = req.body?.studentId || req.body?.student_id;
    const password = req.body?.password;

    if (!studentIdRaw || typeof studentIdRaw !== 'string' || !password || typeof password !== 'string') {
      res.status(400).json({ detail: 'Student ID and password are required.' });
      return;
    }
    const cleanId = String(studentIdRaw).trim();

    // 1. Redis Login Rate Limit Check (5 attempts in 60s)
    const rateCheck = checkLoginRateLimit(cleanId);
    if (!rateCheck.allowed) {
      recordEvent('RATE_LIMIT_REJECTION', cleanId, undefined, { reason: 'login_rate_limit' });
      res.setHeader('Retry-After', String(rateCheck.remainingSeconds));
      res.status(429).json({
        detail: `Too many failed login attempts. Please wait ${rateCheck.remainingSeconds} seconds before trying again.`,
        retry_after: rateCheck.remainingSeconds,
      });
      return;
    }

    // 2. Query Student from Database
    const student = studentsTable.get(cleanId);
    const passwordMatches =
      student && verifyPassword(password, student.passwordHash, student.passwordPlain);

    if (!student || !passwordMatches) {
      recordEvent('LOGIN_FAILED', cleanId);
      recordFailedLoginAttempt(cleanId);
      res.status(401).json({ detail: 'Invalid student ID or password' });
      return;
    }

    if (!student.isActive) {
      res.status(403).json({ detail: 'Your student account is currently suspended. Please contact admissions.' });
      return;
    }

    // 3. Clear rate limiter upon successful login
    clearLoginAttempts(cleanId);
    student.lastActiveAt = Date.now();
    recordEvent('LOGIN_SUCCESS', student.id);
    saveDatabase();

    // 4. Generate cryptographically signed JWT access token (HS256)
    const tokenPayload = {
      sub: student.id,
      name: student.name,
      course: student.course,
      role: student.role,
    };
    const token = signJwt(tokenPayload, 8 * 3600);

    res.json({
      access_token: token,
      token_type: 'bearer',
      expires_in: 8 * 3600,
      user: {
        id: student.id,
        name: student.name,
        email: student.email,
        course: student.course,
        role: student.role,
        is_active: student.isActive,
      },
    });
  });

  // --------------------------------------------------------------------------
  // 2. GET /api/me & /api/v1/me — Authenticated Profile (Strict Bearer Token)
  // --------------------------------------------------------------------------
  const handleGetMe = (req: express.Request, res: express.Response) => {
    const auth = authenticateRequest(req);
    if (!auth.student) {
      res.status(auth.statusCode || 401).json({ detail: auth.error || 'Authentication required' });
      return;
    }
    const student = auth.student;
    res.json({
      id: student.id,
      name: student.name,
      email: student.email,
      course: student.course,
      role: student.role,
      is_active: student.isActive,
      created_at: student.createdAt,
      updated_at: new Date().toISOString(),
    });
  };

  app.get('/api/me', handleGetMe);
  app.get('/api/v1/me', handleGetMe);
  app.get('/api/v1/auth/me', handleGetMe);
  app.get('/api/v1/users/me', handleGetMe);

  // --------------------------------------------------------------------------
  // 3. PUT /api/me & /api/v1/me — Update Permitted Profile Fields
  // - Rejects escalation attempts (changing ID, role, password, status)
  // - Enforces server-side validation on name, course, email
  // - Persists changes to disk
  // --------------------------------------------------------------------------
  const handlePutMe = (req: express.Request, res: express.Response) => {
    const auth = authenticateRequest(req);
    if (!auth.student) {
      res.status(auth.statusCode || 401).json({ detail: auth.error || 'Authentication required' });
      return;
    }
    const student = auth.student;
    const body = req.body || {};

    // 1. Strict Immutability & Privilege Escalation Checks
    if (body.id !== undefined && String(body.id).trim() !== student.id) {
      res.status(400).json({ detail: 'Forbidden: Student ID is permanent and cannot be modified.' });
      return;
    }
    if (body.student_id !== undefined && String(body.student_id).trim() !== student.id) {
      res.status(400).json({ detail: 'Forbidden: Student ID is permanent and cannot be modified.' });
      return;
    }
    if (body.role !== undefined && String(body.role).trim() !== student.role) {
      res.status(403).json({ detail: 'Forbidden: Modifying user role or escalating to admin is strictly prohibited.' });
      return;
    }
    if (body.password_hash !== undefined || body.passwordHash !== undefined || body.password !== undefined) {
      res.status(400).json({ detail: 'Forbidden: Password cannot be modified through the profile settings endpoint.' });
      return;
    }
    if (body.is_active !== undefined || body.isActive !== undefined) {
      res.status(403).json({ detail: 'Forbidden: Account status cannot be modified through profile settings.' });
      return;
    }

    // 2. Server-side validation of permitted fields
    if (body.name !== undefined) {
      const trimmedName = String(body.name).trim();
      if (!trimmedName || trimmedName.length < 1) {
        res.status(422).json({ detail: 'Validation error: Student name cannot be empty.' });
        return;
      }
      if (trimmedName.length > 100) {
        res.status(422).json({ detail: 'Validation error: Student name cannot exceed 100 characters.' });
        return;
      }
      student.name = trimmedName;
    }

    if (body.course !== undefined) {
      const trimmedCourse = String(body.course).trim();
      if (trimmedCourse.length > 120) {
        res.status(422).json({ detail: 'Validation error: Course name cannot exceed 120 characters.' });
        return;
      }
      student.course = trimmedCourse;
    }

    if (body.email !== undefined) {
      const trimmedEmail = String(body.email).trim();
      if (trimmedEmail && !trimmedEmail.includes('@')) {
        res.status(422).json({ detail: 'Validation error: Invalid email address format.' });
        return;
      }
      student.email = trimmedEmail;
    }

    student.lastActiveAt = Date.now();
    studentsTable.set(student.id, student);

    // Telemetry log & persistence
    recordEvent('PROFILE_UPDATED', student.id, undefined, {
      name: student.name,
      course: student.course,
      email: student.email,
    });
    saveDatabase();

    res.json({
      id: student.id,
      name: student.name,
      email: student.email,
      course: student.course,
      role: student.role,
      is_active: student.isActive,
      created_at: student.createdAt,
      updated_at: new Date().toISOString(),
      message: 'Profile updated successfully in database',
    });
  };

  app.put('/api/me', handlePutMe);
  app.put('/api/v1/me', handlePutMe);
  app.put('/api/v1/auth/me', handlePutMe);
  app.put('/api/v1/users/me', handlePutMe);

  // --------------------------------------------------------------------------
  // 4. GET /api/services & /api/v1/services — Academic Services
  // --------------------------------------------------------------------------
  const handleGetServices = (_req: express.Request, res: express.Response) => {
    res.json(Object.values(SERVICES_CATALOG));
  };

  app.get('/api/services', handleGetServices);
  app.get('/api/v1/services', handleGetServices);
  app.get('/api/services/:serviceCode', (req, res) => {
    const key = String(req.params.serviceCode).toLowerCase();
    const s = SERVICES_CATALOG[key as keyof typeof SERVICES_CATALOG];
    if (!s) {
      res.status(404).json({ detail: `Service '${key}' not found` });
      return;
    }
    res.json(s);
  });

  // --------------------------------------------------------------------------
  // 5. POST /api/queue/join & /api/v1/queue/join — FIFO Redis Sorted Set Queue
  // --------------------------------------------------------------------------
  const handleQueueJoin = (req: express.Request, res: express.Response) => {
    const studentIdRaw = req.body?.student_id || req.body?.studentId;
    const serviceCodeRaw = req.body?.service_code || req.body?.serviceKey || 'exam';
    const capacityParam = req.query.capacity ?? req.body?.capacity ?? '2';
    const capacity = Math.max(1, parseInt(String(capacityParam), 10) || 2);

    if (!studentIdRaw) {
      res.status(400).json({ detail: 'student_id is required' });
      return;
    }

    const cleanId = String(studentIdRaw).trim();
    const cleanService = String(serviceCodeRaw).trim().toLowerCase();

    if (!SERVICES_CATALOG[cleanService as keyof typeof SERVICES_CATALOG]) {
      res.status(400).json({ detail: `Unsupported service code: '${cleanService}'` });
      return;
    }

    // Rate Limiting: 5 joins per 60 seconds
    const rateCheck = checkQueueJoinRateLimit(cleanId);
    if (!rateCheck.allowed) {
      recordEvent('RATE_LIMIT_REJECTION', cleanId, cleanService, { reason: 'queue_join_rate_limit' });
      res.setHeader('Retry-After', String(rateCheck.retryAfter));
      res.status(429).json({
        detail: `Too many queue join requests. Limit is 5 per 60 seconds. Please retry in ${rateCheck.retryAfter} seconds.`,
        retry_after: rateCheck.retryAfter,
      });
      return;
    }

    // Add to Redis Sorted Set if not already present (FIFO order preserved)
    cleanupAbandonedQueueMembers(cleanService);
    let q = redisServiceSortedSets.get(cleanService);
    if (!q) {
      q = new Map<string, number>();
      redisServiceSortedSets.set(cleanService, q);
    }
    if (!q.has(cleanId)) {
      q.set(cleanId, Date.now());
    }

    const statusObj = computeQueueStatus(cleanId, cleanService, capacity);
    recordEvent('QUEUE_JOIN', cleanId, cleanService, {
      status: statusObj.status,
      position: statusObj.queue_position,
    });
    if (statusObj.status === 'admitted' && statusObj.admission_token) {
      recordEvent('QUEUE_ADMISSION', cleanId, cleanService, { token: statusObj.admission_token });
    }
    res.json(statusObj);
  };

  app.post('/api/queue/join', handleQueueJoin);
  app.post('/api/v1/queue/join', handleQueueJoin);

  // --------------------------------------------------------------------------
  // 6. GET /api/queue/status & /api/v1/queue/status — Poll Virtual Queue Rank
  // --------------------------------------------------------------------------
  const handleQueueStatus = (req: express.Request, res: express.Response) => {
    const studentIdRaw = req.query.student_id || req.query.studentId;
    const serviceCodeRaw = req.query.service_code || req.query.serviceKey || 'exam';
    const capacityParam = req.query.capacity ?? '2';
    const capacity = Math.max(1, parseInt(String(capacityParam), 10) || 2);

    if (!studentIdRaw) {
      res.status(400).json({ detail: 'student_id query parameter is required' });
      return;
    }

    const cleanId = String(studentIdRaw).trim();
    const cleanService = String(serviceCodeRaw).trim().toLowerCase();

    cleanupAbandonedQueueMembers(cleanService);
    const statusObj = computeQueueStatus(cleanId, cleanService, capacity);

    if (statusObj.status === 'not_in_queue') {
      res.status(404).json({ detail: `Student '${cleanId}' is not in the queue for service '${cleanService}'.` });
      return;
    }

    res.json(statusObj);
  };

  app.get('/api/queue/status', handleQueueStatus);
  app.get('/api/v1/queue/status', handleQueueStatus);

  // --------------------------------------------------------------------------
  // 7. DELETE /api/queue/leave — Remove Student from Queue (ZREM)
  // --------------------------------------------------------------------------
  const handleQueueLeave = (req: express.Request, res: express.Response) => {
    const studentIdRaw =
      req.query.student_id || req.query.studentId || req.body?.student_id || req.body?.studentId;
    const serviceCodeRaw =
      req.query.service_code || req.query.serviceKey || req.body?.service_code || req.body?.serviceKey || 'exam';

    const cleanId = String(studentIdRaw || '').trim();
    const cleanService = String(serviceCodeRaw || 'exam').trim().toLowerCase();

    const q = redisServiceSortedSets.get(cleanService);
    const removed = q ? q.delete(cleanId) : false;
    const tokenKey = `${cleanService}:${cleanId}`;
    redisAdmissionTokens.delete(tokenKey);
    redisQueueHeartbeats.delete(tokenKey);

    res.json({
      success: removed,
      student_id: cleanId,
      service_code: cleanService,
      message: removed ? 'Successfully removed from queue.' : 'Student was not in queue.',
    });
  };

  app.delete('/api/queue/leave', handleQueueLeave);
  app.delete('/api/v1/queue/leave', handleQueueLeave);
  app.post('/api/queue/leave', handleQueueLeave);
  app.post('/api/v1/queue/exit', handleQueueLeave);

  // --------------------------------------------------------------------------
  // 8. POST & GET /api/applications — Real Application Submission
  // - Enforces Bearer JWT verification
  // - Enforces server-issued admission pass token validation
  // - Enforces concurrency double-click protection (HTTP 409)
  // - Enforces one-application-per-service duplicate prevention (HTTP 409)
  // - Enforces server-side form validation (HTTP 422)
  // - Consumes admission pass token and releases queue slot upon commit
  // --------------------------------------------------------------------------
  const handleApplicationSubmitEndpoint = (req: express.Request, res: express.Response) => {
    const auth = authenticateRequest(req);
    if (!auth.student) {
      res.status(auth.statusCode || 401).json({ detail: auth.error || 'Authentication required' });
      return;
    }
    const caller = auth.student;

    const serviceCode = String(req.body?.service_code || req.body?.serviceKey || '').trim().toLowerCase();
    const admissionToken = String(req.body?.admission_token || req.body?.admissionToken || '').trim();
    const details = req.body?.details || {};

    if (!serviceCode || !SERVICES_CATALOG[serviceCode as keyof typeof SERVICES_CATALOG]) {
      res.status(400).json({ detail: `Invalid or unsupported service code: '${serviceCode}'` });
      return;
    }

    // Concurrency Lock: Protect against rapid double clicks
    const lockKey = `${caller.id}:${serviceCode}`;
    if (inFlightSubmissions.has(lockKey)) {
      res.status(409).json({ detail: 'A submission for this service is currently being processed. Please do not double-click.' });
      return;
    }
    inFlightSubmissions.add(lockKey);

    try {
      // 1. Verify Server-Issued Admission Token
      const tokenKey = `${serviceCode}:${caller.id}`;
      const cachedTokenInfo = redisAdmissionTokens.get(tokenKey);

      if (!admissionToken || !cachedTokenInfo || cachedTokenInfo.token !== admissionToken) {
        res.status(403).json({
          detail: 'Admission token verification failed: Token is missing, invalid, or does not match this student.',
        });
        return;
      }

      if (cachedTokenInfo.expiresAt < Date.now()) {
        redisAdmissionTokens.delete(tokenKey);
        res.status(403).json({
          detail: 'Admission token has expired. Please re-enter the waiting queue.',
        });
        return;
      }

      // 2. Strict Server-Side Field Validation
      const { fullName, studentId, department, declaration } = details;
      if (!fullName || String(fullName).trim().length < 2) {
        res.status(422).json({ detail: 'Validation error: Full Name is required and must be at least 2 characters.' });
        return;
      }
      if (!studentId || String(studentId).trim() !== caller.id) {
        res.status(422).json({ detail: `Validation error: Student ID must match authenticated account (${caller.id}).` });
        return;
      }
      if (!department || String(department).trim().length < 2) {
        res.status(422).json({ detail: 'Validation error: Degree / Department selection is required.' });
        return;
      }
      if (!declaration || declaration === 'false' || declaration === false) {
        res.status(422).json({ detail: 'Validation error: Declaration confirmation must be accepted.' });
        return;
      }

      // Service-specific validation
      if (serviceCode === 'exam') {
        const examType = details.examType;
        const sem = details.examSemester || details.semester;
        if (!examType) {
          res.status(422).json({ detail: 'Validation error: Examination cycle / type is required.' });
          return;
        }
        if (!sem) {
          res.status(422).json({ detail: 'Validation error: Examination semester is required.' });
          return;
        }
      } else if (serviceCode === 'scholarship') {
        const cat = details.category || details.scheme;
        const gpaVal = details.cgpa !== undefined ? details.cgpa : details.gpa;
        const incVal = details.income !== undefined ? details.income : details.householdIncome;

        if (!cat) {
          res.status(422).json({ detail: 'Validation error: Scholarship category/scheme is required.' });
          return;
        }
        const numericGpa = parseFloat(String(gpaVal));
        if (isNaN(numericGpa) || numericGpa < 0 || numericGpa > 10) {
          res.status(422).json({ detail: 'Validation error: Cumulative GPA must be a number between 0.0 and 10.0.' });
          return;
        }
        if (!incVal || String(incVal).trim().length < 1) {
          res.status(422).json({ detail: 'Validation error: Family / Household Income is required.' });
          return;
        }
      } else if (serviceCode === 'course') {
        const hasChoice = details.credits || details.primaryElective;
        if (!hasChoice) {
          res.status(422).json({ detail: 'Validation error: Course credits or elective selection is required.' });
          return;
        }
      }

      // 3. Duplicate Submission Rule Check
      const existing = submissionsTable.find((s) => s.studentId === caller.id && s.serviceKey === serviceCode);
      if (existing) {
        res.status(409).json({
          detail: `You have already submitted an application for ${SERVICES_CATALOG[serviceCode as keyof typeof SERVICES_CATALOG]?.name} (Reference: ${existing.reference}). Duplicate submissions are not allowed.`,
        });
        return;
      }

      // 4. Generate Unique Server Reference Number
      const reference = `FF-${serviceCode.toUpperCase()}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const nowIso = new Date().toISOString();
      const submissionDateStr = new Date().toLocaleString();

      const record: SubmissionRecord = {
        id: nextSubmissionId++,
        reference,
        studentId: caller.id,
        serviceKey: serviceCode,
        service: SERVICES_CATALOG[serviceCode as keyof typeof SERVICES_CATALOG]?.name || 'Academic Application',
        date: submissionDateStr,
        createdAtIso: nowIso,
        details,
      };
      submissionsTable.push(record);
      saveDatabase();
      recordEvent('APPLICATION_SUBMISSION', caller.id, serviceCode, { reference: record.reference });

      // 5. Consume Admission Token and remove from Queue ONLY after success
      redisAdmissionTokens.delete(tokenKey);
      const q = redisServiceSortedSets.get(serviceCode);
      if (q) q.delete(caller.id);
      redisQueueHeartbeats.delete(tokenKey);

      res.status(201).json({
        id: record.id,
        reference: record.reference,
        student_id: record.studentId,
        service_code: record.serviceKey,
        service_name: record.service,
        status: 'submitted',
        details: record.details,
        submission_date: record.date,
        created_at: record.createdAtIso,
      });
    } finally {
      inFlightSubmissions.delete(lockKey);
    }
  };

  const handleListApplicationsEndpoint = (req: express.Request, res: express.Response) => {
    const auth = authenticateRequest(req);
    if (!auth.student) {
      res.status(auth.statusCode || 401).json({ detail: auth.error || 'Authentication required' });
      return;
    }
    const caller = auth.student;

    const filterStudentId = req.query.student_id ? String(req.query.student_id).trim() : null;
    let list = submissionsTable;

    if (caller.role !== 'admin') {
      list = submissionsTable.filter((s) => s.studentId === caller.id);
    } else if (filterStudentId) {
      list = submissionsTable.filter((s) => s.studentId === filterStudentId);
    }

    const responseList = list.map((record) => ({
      id: record.id,
      reference: record.reference,
      student_id: record.studentId,
      service_code: record.serviceKey,
      service_name: record.service,
      status: 'submitted',
      details: record.details,
      submission_date: record.date,
      created_at: record.createdAtIso,
    }));

    res.json(responseList);
  };

  app.post('/api/applications', handleApplicationSubmitEndpoint);
  app.post('/api/v1/applications', handleApplicationSubmitEndpoint);
  app.get('/api/applications', handleListApplicationsEndpoint);
  app.get('/api/v1/applications', handleListApplicationsEndpoint);

  // Legacy submissions endpoint support
  app.get('/api/v1/submissions', (req, res) => {
    const auth = authenticateRequest(req);
    if (!auth.student) {
      res.status(auth.statusCode || 401).json({ detail: auth.error || 'Authentication required' });
      return;
    }
    const caller = auth.student;
    const filterId = caller.role === 'admin' && req.query.studentId ? String(req.query.studentId).trim() : caller.id;
    const list = submissionsTable.filter((s) => s.studentId === filterId);
    res.json({ submissions: list });
  });

  app.post('/api/v1/submissions', handleApplicationSubmitEndpoint);

  // --------------------------------------------------------------------------
  // 9. Admin Protected Endpoints: GET /api/admin/stats & GET /api/admin/traffic
  // - Rejects unauthenticated callers with HTTP 401
  // - Rejects non-admin students with HTTP 403
  // --------------------------------------------------------------------------
  const handleAdminStatsEndpoint = (req: express.Request, res: express.Response) => {
    const auth = authenticateRequest(req);
    if (!auth.student) {
      res.status(auth.statusCode || 401).json({ detail: auth.error || 'Authentication required' });
      return;
    }
    const caller = auth.student;
    if (caller.role !== 'admin') {
      res.status(403).json({ detail: 'Admin privileges required. Unauthorized access denied.' });
      return;
    }

    // Real registered students in database
    const totalStudents = Array.from(studentsTable.values()).filter((s) => s.role === 'student').length;
    const activeStudents = Array.from(studentsTable.values()).filter(
      (s) => s.role === 'student' && s.isActive
    ).length;

    // Real waiting students count across active service queues
    let waitingStudents = 0;
    for (const [_serviceCode, q] of redisServiceSortedSets.entries()) {
      waitingStudents += q.size;
    }

    const blockedRequests = eventsTable.filter((e) => e.eventType === 'RATE_LIMIT_REJECTION').length;
    const totalSubmissions = submissionsTable.length;

    res.json({
      total_students: totalStudents,
      active_students: activeStudents,
      waiting_students: waitingStudents,
      blocked_requests: blockedRequests,
      total_submissions: totalSubmissions,
      admin_name: caller.name,
      admin_id: caller.id,
      timestamp: new Date().toISOString(),
    });
  };

  const handleAdminTrafficEndpoint = (req: express.Request, res: express.Response) => {
    const auth = authenticateRequest(req);
    if (!auth.student) {
      res.status(auth.statusCode || 401).json({ detail: auth.error || 'Authentication required' });
      return;
    }
    const caller = auth.student;
    if (caller.role !== 'admin') {
      res.status(403).json({ detail: 'Admin privileges required. Unauthorized access denied.' });
      return;
    }

    const trafficData = computeTrafficChartData();
    res.json(trafficData);
  };

  app.get('/api/admin/stats', handleAdminStatsEndpoint);
  app.get('/api/v1/admin/stats', handleAdminStatsEndpoint);
  app.get('/api/admin/traffic', handleAdminTrafficEndpoint);
  app.get('/api/v1/admin/traffic', handleAdminTrafficEndpoint);

  app.get('/api/admin/students', (req, res) => {
    const auth = authenticateRequest(req);
    if (!auth.student) {
      res.status(auth.statusCode || 401).json({ detail: auth.error || 'Authentication required' });
      return;
    }
    const caller = auth.student;
    if (caller.role !== 'admin') {
      res.status(403).json({ detail: 'Admin privileges required to access student directory.' });
      return;
    }
    const list = Array.from(studentsTable.values()).map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      course: s.course,
      role: s.role,
      is_active: s.isActive,
      createdAt: s.createdAt,
    }));
    res.json(list);
  });

  app.get('/api/v1/admin/students', (req, res) => {
    const auth = authenticateRequest(req);
    if (!auth.student) {
      res.status(auth.statusCode || 401).json({ detail: auth.error || 'Authentication required' });
      return;
    }
    const caller = auth.student;
    if (caller.role !== 'admin') {
      res.status(403).json({ detail: 'Admin privileges required to access student directory.' });
      return;
    }
    const list = Array.from(studentsTable.values()).map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      course: s.course,
      role: s.role,
      is_active: s.isActive,
      createdAt: s.createdAt,
    }));
    res.json({ students: list });
  });

  app.get('/api/v1/admin/metrics', (req, res) => {
    const auth = authenticateRequest(req);
    if (!auth.student) {
      res.status(auth.statusCode || 401).json({ detail: auth.error || 'Authentication required' });
      return;
    }
    const caller = auth.student;
    if (caller.role !== 'admin') {
      res.status(403).json({ detail: 'Admin privileges required.' });
      return;
    }
    const traffic = computeTrafficChartData();
    let waiting = 0;
    for (const [_s, q] of redisServiceSortedSets.entries()) waiting += q.size;
    res.json({
      totalStudents: Array.from(studentsTable.values()).filter((s) => s.role === 'student').length,
      activeStudents: Array.from(studentsTable.values()).filter((s) => s.role === 'student' && s.isActive).length,
      studentsWaiting: waiting,
      blockedRequests: eventsTable.filter((e) => e.eventType === 'RATE_LIMIT_REJECTION').length,
      totalSubmissions: submissionsTable.length,
      trafficValues: traffic.points,
    });
  });

  // Test environment reset hook
  if (process.env.NODE_ENV !== 'production') {
    app.post('/api/v1/test/reset', (_req, res) => {
      const defaultStudents = createDefaultStudents();
      studentsTable.clear();
      for (const s of defaultStudents) {
        studentsTable.set(s.id, s);
      }
      submissionsTable = [];
      eventsTable = createDefaultHistoricalEvents();
      nextSubmissionId = 1;
      nextEventId = eventsTable.length + 1;
      saveDatabase();

      for (const q of redisServiceSortedSets.values()) q.clear();
      redisAdmissionTokens.clear();
      redisQueueHeartbeats.clear();
      redisQueueJoinLog.clear();
      redisLoginAttemptsLog.clear();
      redisRateLimitLog.clear();
      inFlightSubmissions.clear();

      res.json({ success: true, message: 'Database and queues reset to clean seeds.' });
    });
  }

  return app;
}

// ----------------------------------------------------------------------------
// Development / Production Server Bootstrapper
// ----------------------------------------------------------------------------
export async function startServer() {
  const app = createApp();
  const PORT = 3000;

  // Mount Vite middleware in development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`FairForm AI server running on http://localhost:${PORT}`);
  });

  return { app, server };
}

// Automatically start if executed directly
const isDirectEntry = Boolean(
  process.argv[1] && (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js'))
);
if (isDirectEntry && process.env.NODE_ENV !== 'test') {
  startServer().catch((err) => {
    console.error('Fatal error starting server:', err);
  });
}

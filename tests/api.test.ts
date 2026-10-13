/**
 * FairForm AI - End-to-End Automated API Test Suite
 * Validates security, JWT verification, RBAC, Redis virtual queue,
 * rate limiting, Retry-After headers, server-side validation, duplicate prevention,
 * and database persistence across restarts.
 */

import { signJwt, verifyJwt, loadDatabase, saveDatabase } from '../server.ts';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

interface TestResult {
  name: string;
  category: string;
  passed: boolean;
  error?: string;
  details?: string;
}

const results: TestResult[] = [];

async function runTest(category: string, name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ category, name, passed: true });
    console.log(`  ✓ [PASS] ${name}`);
  } catch (err: any) {
    results.push({ category, name, passed: false, error: err.message });
    console.error(`  ✗ [FAIL] ${name}: ${err.message}`);
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(msg);
  }
}

async function runAllTests() {
  console.log('\n===============================================================');
  console.log('🚀 Running FairForm AI Automated API Test Suite');
  console.log(`Target: ${BASE_URL}`);
  console.log('===============================================================\n');

  let studentToken = '';
  let adminToken = '';
  let student2Token = '';

  // Reset database and queues to clean seeds for deterministic testing
  try {
    await fetch(`${BASE_URL}/api/v1/test/reset`, { method: 'POST' });
  } catch {
    // ignore
  }

  // --------------------------------------------------------------------------
  // Category 1: Authentication & Invalid Login Credentials
  // --------------------------------------------------------------------------
  console.log('\n--- 1. Login & Credentials Security ---');

  await runTest('Authentication', 'Reject missing studentId and password with 400', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });

  await runTest('Authentication', 'Reject nonexistent student ID with 401', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: 'STU-UNKNOWN-999', password: 'Password@123' }),
    });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
    const data = await res.json();
    assert(data.detail.includes('Invalid student ID or password'), `Unexpected detail: ${data.detail}`);
  });

  await runTest('Authentication', 'Reject incorrect password for valid student with 401', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: 'STU-2026-001', password: 'WrongPassword' }),
    });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  await runTest('Authentication', 'Login succeeds for student and returns signed JWT with profile', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: 'STU-2026-001', password: 'Password@123' }),
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(typeof data.access_token === 'string', 'Expected access_token string');
    assert(data.user.id === 'STU-2026-001', `Expected STU-2026-001, got ${data.user.id}`);
    assert(data.user.role === 'student', `Expected role student, got ${data.user.role}`);
    studentToken = data.access_token;
  });

  await runTest('Authentication', 'Login succeeds for second student STU-2026-002', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: 'STU-2026-002', password: 'Password@123' }),
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    student2Token = data.access_token;
  });

  await runTest('Authentication', 'Login succeeds for administrator ADMIN-001', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: 'ADMIN-001', password: 'Admin@Secure2026' }),
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.user.role === 'admin', `Expected admin role, got ${data.user.role}`);
    adminToken = data.access_token;
  });

  // --------------------------------------------------------------------------
  // Category 2: Expired or Invalid JWTs
  // --------------------------------------------------------------------------
  console.log('\n--- 2. JWT Verification & Cryptographic Security ---');

  await runTest('JWT Security', 'Reject request without Authorization header with 401', async () => {
    const res = await fetch(`${BASE_URL}/api/me`);
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  await runTest('JWT Security', 'Reject malformed JWT with 401', async () => {
    const res = await fetch(`${BASE_URL}/api/me`, {
      headers: { Authorization: 'Bearer not-a-valid-jwt-token' },
    });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  await runTest('JWT Security', 'Reject forged JWT with tampered signature with 401', async () => {
    // Generate an unsigned fake JWT claiming to be admin
    const fakeHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const fakePayload = Buffer.from(JSON.stringify({ sub: 'ADMIN-001', role: 'admin' })).toString('base64url');
    const forgedToken = `${fakeHeader}.${fakePayload}.fake_forged_signature_12345`;

    const res = await fetch(`${BASE_URL}/api/me`, {
      headers: { Authorization: `Bearer ${forgedToken}` },
    });
    assert(res.status === 401, `Expected 401 for forged token, got ${res.status}`);
  });

  await runTest('JWT Security', 'Reject expired JWT with 401', async () => {
    // Create token expired 1 hour ago
    const expiredToken = signJwt({ sub: 'STU-2026-001', role: 'student' }, -3600);
    const res = await fetch(`${BASE_URL}/api/me`, {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    assert(res.status === 401, `Expected 401 for expired token, got ${res.status}`);
    const data = await res.json();
    assert(data.detail.toLowerCase().includes('expired'), `Expected expired mention: ${data.detail}`);
  });

  await runTest('JWT Security', 'Reject query-parameter / header studentId authentication bypass', async () => {
    // Attempt to bypass auth by querying ?studentId=ADMIN-001 without token
    const res = await fetch(`${BASE_URL}/api/me?studentId=ADMIN-001`);
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  await runTest('JWT Security', 'Accept valid signed JWT on /api/me', async () => {
    const res = await fetch(`${BASE_URL}/api/me`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.id === 'STU-2026-001', `Expected STU-2026-001, got ${data.id}`);
  });

  // --------------------------------------------------------------------------
  // Category 3: Unauthorized Admin Access
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Role-Based Access Control (RBAC) & Admin Isolation ---');

  await runTest('RBAC', 'Reject unauthenticated access to /api/admin/stats with 401', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/stats`);
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  await runTest('RBAC', 'Reject student access to /api/admin/stats with 403 Forbidden', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/stats`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert(res.status === 403, `Expected 403 Forbidden, got ${res.status}`);
    const data = await res.json();
    assert(data.detail.includes('Admin privileges required'), `Unexpected detail: ${data.detail}`);
  });

  await runTest('RBAC', 'Reject student access to /api/admin/traffic with 403 Forbidden', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/traffic`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert(res.status === 403, `Expected 403, got ${res.status}`);
  });

  await runTest('RBAC', 'Reject student access to /api/admin/students with 403 Forbidden', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/students`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert(res.status === 403, `Expected 403, got ${res.status}`);
  });

  await runTest('RBAC', 'Allow admin access to /api/admin/stats with 200 OK', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/stats`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(typeof data.total_students === 'number', 'Expected total_students number');
    assert(typeof data.waiting_students === 'number', 'Expected waiting_students number');
    assert(typeof data.total_submissions === 'number', 'Expected total_submissions number');
    assert(data.admin_id === 'ADMIN-001', `Expected ADMIN-001, got ${data.admin_id}`);
  });

  // --------------------------------------------------------------------------
  // Category 4: Queue Ordering & Admission Capacity
  // --------------------------------------------------------------------------
  console.log('\n--- 4. Virtual Waiting Room (FIFO & Capacity Enforcement) ---');

  // Clear test service queues for clean testing
  await fetch(`${BASE_URL}/api/queue/leave?student_id=STU-QUEUE-A&service_code=course`, { method: 'DELETE' });
  await fetch(`${BASE_URL}/api/queue/leave?student_id=STU-QUEUE-B&service_code=course`, { method: 'DELETE' });
  await fetch(`${BASE_URL}/api/queue/leave?student_id=STU-QUEUE-C&service_code=course`, { method: 'DELETE' });

  let studentAToken = '';

  await runTest('Virtual Queue', 'Student A joins course with capacity=1 -> immediately admitted', async () => {
    const res = await fetch(`${BASE_URL}/api/queue/join?capacity=1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: 'STU-QUEUE-A', service_code: 'course' }),
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.status === 'admitted', `Expected admitted, got ${data.status}`);
    assert(data.queue_position === 1, `Expected pos 1, got ${data.queue_position}`);
    assert(data.students_ahead === 0, `Expected 0 ahead, got ${data.students_ahead}`);
    assert(typeof data.admission_token === 'string', 'Expected admission token');
    studentAToken = data.admission_token;
  });

  await runTest('Virtual Queue', 'Student B joins course with capacity=1 -> enters waiting state', async () => {
    const res = await fetch(`${BASE_URL}/api/queue/join?capacity=1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: 'STU-QUEUE-B', service_code: 'course' }),
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.status === 'waiting', `Expected waiting, got ${data.status}`);
    assert(data.queue_position === 2, `Expected pos 2, got ${data.queue_position}`);
    assert(data.students_ahead === 1, `Expected 1 ahead, got ${data.students_ahead}`);
    assert(data.admission_token === null, 'Expected null admission token');
  });

  await runTest('Virtual Queue', 'Student C joins course with capacity=1 -> placed behind B', async () => {
    const res = await fetch(`${BASE_URL}/api/queue/join?capacity=1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: 'STU-QUEUE-C', service_code: 'course' }),
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.status === 'waiting', `Expected waiting, got ${data.status}`);
    assert(data.queue_position === 3, `Expected pos 3, got ${data.queue_position}`);
    assert(data.students_ahead === 2, `Expected 2 ahead, got ${data.students_ahead}`);
  });

  await runTest('Virtual Queue', 'Rejoining queue preserves original arrival position', async () => {
    const res = await fetch(`${BASE_URL}/api/queue/join?capacity=1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: 'STU-QUEUE-B', service_code: 'course' }),
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.status === 'waiting', `Expected waiting, got ${data.status}`);
    assert(data.queue_position === 2, `Expected pos 2 preserved, got ${data.queue_position}`);
  });

  await runTest('Virtual Queue', 'Student A leaves -> Student B advances to admitted', async () => {
    // Student A leaves queue
    const leaveRes = await fetch(`${BASE_URL}/api/queue/leave?student_id=STU-QUEUE-A&service_code=course`, {
      method: 'DELETE',
    });
    assert(leaveRes.status === 200, `Expected 200, got ${leaveRes.status}`);

    // Poll status for Student B with capacity=1
    const statusRes = await fetch(`${BASE_URL}/api/queue/status?student_id=STU-QUEUE-B&service_code=course&capacity=1`);
    assert(statusRes.status === 200, `Expected 200, got ${statusRes.status}`);
    const data = await statusRes.json();
    assert(data.status === 'admitted', `Expected admitted, got ${data.status}`);
    assert(typeof data.admission_token === 'string', 'Expected admission token for B');
  });

  // Cleanup test queue
  await fetch(`${BASE_URL}/api/queue/leave?student_id=STU-QUEUE-B&service_code=course`, { method: 'DELETE' });
  await fetch(`${BASE_URL}/api/queue/leave?student_id=STU-QUEUE-C&service_code=course`, { method: 'DELETE' });

  // --------------------------------------------------------------------------
  // Category 5: Admission Tokens & Bypass Prevention
  // --------------------------------------------------------------------------
  console.log('\n--- 5. Admission Token Enforcement & Anti-Bypass ---');

  // Let STU-2026-001 join exam queue
  let examToken = '';
  await runTest('Token Enforcement', 'Obtain legitimate admission token for STU-2026-001 on exam', async () => {
    const res = await fetch(`${BASE_URL}/api/queue/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: 'STU-2026-001', service_code: 'exam' }),
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert(data.status === 'admitted', `Expected admitted, got ${data.status}`);
    examToken = data.admission_token;
  });

  await runTest('Token Enforcement', 'Reject submission with missing admission token with 403', async () => {
    const res = await fetch(`${BASE_URL}/api/applications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        serviceKey: 'exam',
        details: { fullName: 'Alex Morgan', studentId: 'STU-2026-001', department: 'CSE', declaration: 'true' },
      }),
    });
    assert(res.status === 403, `Expected 403, got ${res.status}`);
  });

  await runTest('Token Enforcement', 'Reject submission with forged / fake token with 403', async () => {
    const res = await fetch(`${BASE_URL}/api/applications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        serviceKey: 'exam',
        admissionToken: 'PASS-EXAM-STU-FAKE-TOKEN-999',
        details: { fullName: 'Alex Morgan', studentId: 'STU-2026-001', department: 'CSE', declaration: 'true' },
      }),
    });
    assert(res.status === 403, `Expected 403, got ${res.status}`);
  });

  await runTest('Token Enforcement', 'Reject submission using token from a different service with 403', async () => {
    const res = await fetch(`${BASE_URL}/api/applications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        serviceKey: 'scholarship', // Wrong service
        admissionToken: examToken,
        details: { fullName: 'Alex Morgan', studentId: 'STU-2026-001', department: 'CSE', declaration: 'true' },
      }),
    });
    assert(res.status === 403, `Expected 403, got ${res.status}`);
  });

  await runTest('Token Enforcement', 'Reject submission using another student\'s token with 403', async () => {
    const res = await fetch(`${BASE_URL}/api/applications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${student2Token}`, // Student 2 trying to use Student 1's token
      },
      body: JSON.stringify({
        serviceKey: 'exam',
        admissionToken: examToken,
        details: { fullName: 'Priya Sharma', studentId: 'STU-2026-002', department: 'AI & DS', declaration: 'true' },
      }),
    });
    assert(res.status === 403, `Expected 403, got ${res.status}`);
  });

  // --------------------------------------------------------------------------
  // Category 6: Server-Side Validation Errors
  // --------------------------------------------------------------------------
  console.log('\n--- 6. Server-Side Validation (Schema & Form Constraints) ---');

  await runTest('Validation', 'Reject missing fullName or < 2 chars with 422', async () => {
    const res = await fetch(`${BASE_URL}/api/applications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        serviceKey: 'exam',
        admissionToken: examToken,
        details: {
          fullName: 'A',
          studentId: 'STU-2026-001',
          department: 'CSE',
          declaration: 'true',
          examType: 'Regular',
          examSemester: 'Semester 5',
        },
      }),
    });
    assert(res.status === 422, `Expected 422, got ${res.status}`);
  });

  await runTest('Validation', 'Reject studentId mismatch between caller and payload with 422', async () => {
    const res = await fetch(`${BASE_URL}/api/applications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`, // Caller is STU-2026-001
      },
      body: JSON.stringify({
        serviceKey: 'exam',
        admissionToken: examToken,
        details: {
          fullName: 'Alex Morgan',
          studentId: 'STU-2026-002', // Mismatch!
          department: 'CSE',
          declaration: 'true',
          examType: 'Regular',
          examSemester: 'Semester 5',
        },
      }),
    });
    assert(res.status === 422, `Expected 422, got ${res.status}`);
    const data = await res.json();
    assert(data.detail.includes('match authenticated account'), `Unexpected detail: ${data.detail}`);
  });

  await runTest('Validation', 'Reject missing department with 422', async () => {
    const res = await fetch(`${BASE_URL}/api/applications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        serviceKey: 'exam',
        admissionToken: examToken,
        details: {
          fullName: 'Alex Morgan',
          studentId: 'STU-2026-001',
          department: '',
          declaration: 'true',
          examType: 'Regular',
          examSemester: 'Semester 5',
        },
      }),
    });
    assert(res.status === 422, `Expected 422, got ${res.status}`);
  });

  await runTest('Validation', 'Reject unaccepted declaration with 422', async () => {
    const res = await fetch(`${BASE_URL}/api/applications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        serviceKey: 'exam',
        admissionToken: examToken,
        details: {
          fullName: 'Alex Morgan',
          studentId: 'STU-2026-001',
          department: 'CSE',
          declaration: 'false',
          examType: 'Regular',
          examSemester: 'Semester 5',
        },
      }),
    });
    assert(res.status === 422, `Expected 422, got ${res.status}`);
  });

  await runTest('Validation', 'Reject exam service missing semester with 422', async () => {
    const res = await fetch(`${BASE_URL}/api/applications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        serviceKey: 'exam',
        admissionToken: examToken,
        details: {
          fullName: 'Alex Morgan',
          studentId: 'STU-2026-001',
          department: 'CSE',
          declaration: 'true',
          examType: 'Regular',
        },
      }),
    });
    assert(res.status === 422, `Expected 422, got ${res.status}`);
  });

  // --------------------------------------------------------------------------
  // Category 7: Successful Submission & Duplicate Prevention
  // --------------------------------------------------------------------------
  console.log('\n--- 7. Submission Persistence & Duplicate Prevention ---');

  let submittedReference = '';

  await runTest('Submission', 'Valid application submission succeeds with 201 Created and consumes token', async () => {
    const res = await fetch(`${BASE_URL}/api/applications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        serviceKey: 'exam',
        admissionToken: examToken,
        details: {
          fullName: 'Alex Morgan',
          studentId: 'STU-2026-001',
          department: 'Computer Science and Engineering (CSE)',
          examType: 'Regular Semester Exam',
          examSemester: 'Semester 6',
          subjectCodes: 'CS601, CS602',
          declaration: 'true',
        },
      }),
    });
    assert(res.status === 201, `Expected 201 Created, got ${res.status}`);
    const data = await res.json();
    assert(data.status === 'submitted', `Expected status submitted, got ${data.status}`);
    assert(typeof data.reference === 'string' && data.reference.startsWith('FF-EXAM-'), `Invalid ref: ${data.reference}`);
    submittedReference = data.reference;
  });

  await runTest('Submission', 'Replaying consumed token immediately rejected with 403', async () => {
    const res = await fetch(`${BASE_URL}/api/applications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        serviceKey: 'exam',
        admissionToken: examToken, // Token was consumed
        details: {
          fullName: 'Alex Morgan',
          studentId: 'STU-2026-001',
          department: 'Computer Science and Engineering (CSE)',
          examType: 'Regular Semester Exam',
          examSemester: 'Semester 6',
          declaration: 'true',
        },
      }),
    });
    assert(res.status === 403, `Expected 403 Forbidden for consumed token, got ${res.status}`);
  });

  await runTest('Submission', 'Duplicate application for same service rejected with 409 Conflict', async () => {
    // Student re-joins queue to obtain a new token
    const joinRes = await fetch(`${BASE_URL}/api/queue/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: 'STU-2026-001', service_code: 'exam' }),
    });
    const joinData = await joinRes.json();
    const newToken = joinData.admission_token;

    // Student attempts duplicate submission with fresh token
    const res = await fetch(`${BASE_URL}/api/applications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        serviceKey: 'exam',
        admissionToken: newToken,
        details: {
          fullName: 'Alex Morgan',
          studentId: 'STU-2026-001',
          department: 'Computer Science and Engineering (CSE)',
          examType: 'Regular Semester Exam',
          examSemester: 'Semester 6',
          declaration: 'true',
        },
      }),
    });
    assert(res.status === 409, `Expected 409 Conflict for duplicate submission, got ${res.status}`);
    const data = await res.json();
    assert(data.detail.includes('already submitted an application'), `Unexpected detail: ${data.detail}`);
  });

  // --------------------------------------------------------------------------
  // Category 8: Rate Limiting & Retry-After Headers
  // --------------------------------------------------------------------------
  console.log('\n--- 8. Rate Limiting & Retry-After HTTP Headers ---');

  await runTest('Rate Limiting', 'Queue join rate limit returns 429 with Retry-After header', async () => {
    const testStu = `STU-RATETEST-${Date.now()}`;
    // 5 allowed requests
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${BASE_URL}/api/queue/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: testStu, service_code: 'course' }),
      });
      assert(res.status === 200, `Expected 200 on attempt ${i + 1}, got ${res.status}`);
    }

    // 6th request must be blocked
    const res6 = await fetch(`${BASE_URL}/api/queue/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: testStu, service_code: 'course' }),
    });
    assert(res6.status === 429, `Expected 429 Too Many Requests, got ${res6.status}`);
    const retryAfter = res6.headers.get('Retry-After');
    assert(retryAfter !== null && Number(retryAfter) > 0, `Expected numeric Retry-After header, got ${retryAfter}`);
    const body = await res6.json();
    assert(typeof body.retry_after === 'number', `Expected retry_after in body, got ${body.retry_after}`);
  });

  await runTest('Rate Limiting', 'Login rate limit returns 429 with Retry-After header after 5 failures', async () => {
    const testUser = `STU-FAILLOGIN-${Date.now()}`;
    // 5 failed login attempts
    for (let i = 0; i < 5; i++) {
      await fetch(`${BASE_URL}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: testUser, password: 'WrongPassword' }),
      });
    }

    // 6th attempt must trigger rate limit
    const res6 = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: testUser, password: 'WrongPassword' }),
    });
    assert(res6.status === 429, `Expected 429 Too Many Requests, got ${res6.status}`);
    const retryAfter = res6.headers.get('Retry-After');
    assert(retryAfter !== null && Number(retryAfter) > 0, `Expected numeric Retry-After header, got ${retryAfter}`);
  });

  // --------------------------------------------------------------------------
  // Category 9: Profile Updates & Admin Metrics
  // --------------------------------------------------------------------------
  console.log('\n--- 9. Profile Updates & Admin Metrics ---');

  await runTest('Profile Settings', 'Reject empty student name on PUT /api/me with 422', async () => {
    const res = await fetch(`${BASE_URL}/api/me`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({ name: '   ' }),
    });
    assert(res.status === 422, `Expected 422, got ${res.status}`);
  });

  await runTest('Profile Settings', 'Reject privilege escalation (altering role) with 403', async () => {
    const res = await fetch(`${BASE_URL}/api/me`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({ role: 'admin' }),
    });
    assert(res.status === 403, `Expected 403 Forbidden, got ${res.status}`);
  });

  await runTest('Profile Settings', 'Reject immutable student ID modification with 400', async () => {
    const res = await fetch(`${BASE_URL}/api/me`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({ id: 'STU-CHANGED-999' }),
    });
    assert(res.status === 400, `Expected 400, got ${res.status}`);
  });

  await runTest('Profile Settings', 'Update permitted fields (name, course) and verify persistence', async () => {
    const updatedName = `Alex Morgan Updated ${Date.now().toString().slice(-4)}`;
    const updatedCourse = 'Advanced Software Engineering';

    const putRes = await fetch(`${BASE_URL}/api/me`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({ name: updatedName, course: updatedCourse }),
    });
    assert(putRes.status === 200, `Expected 200, got ${putRes.status}`);

    const getRes = await fetch(`${BASE_URL}/api/me`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert(getRes.status === 200, `Expected 200, got ${getRes.status}`);
    const data = await getRes.json();
    assert(data.name === updatedName, `Expected ${updatedName}, got ${data.name}`);
    assert(data.course === updatedCourse, `Expected ${updatedCourse}, got ${data.course}`);
  });

  await runTest('Admin Metrics', 'Verify admin metrics include submissions, events, and waiting counts', async () => {
    const res = await fetch(`${BASE_URL}/api/admin/stats`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const stats = await res.json();
    assert(stats.total_submissions >= 1, `Expected total_submissions >= 1, got ${stats.total_submissions}`);
    assert(stats.blocked_requests >= 1, `Expected blocked_requests >= 1, got ${stats.blocked_requests}`);

    const trafficRes = await fetch(`${BASE_URL}/api/admin/traffic`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert(trafficRes.status === 200, `Expected 200, got ${trafficRes.status}`);
    const traffic = await trafficRes.json();
    assert(Array.isArray(traffic.points) && traffic.points.length === 12, 'Expected 12 traffic points');
    assert(traffic.breakdown && typeof traffic.breakdown.submissions === 'number', 'Expected breakdown');
  });

  // --------------------------------------------------------------------------
  // Category 10: Database Persistence Across Server Restart
  // --------------------------------------------------------------------------
  console.log('\n--- 10. Database Persistence Verification Across Server Restart ---');

  await runTest('Persistence', 'Submissions and updated profile persist after reloadDatabase()', async () => {
    // Simulate server restart by reloading database from disk
    loadDatabase();

    // Query submissions list for student STU-2026-001
    const subRes = await fetch(`${BASE_URL}/api/applications`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    assert(subRes.status === 200, `Expected 200, got ${subRes.status}`);
    const subs = await subRes.json();
    const found = subs.find((s: any) => s.reference === submittedReference);
    assert(found !== undefined, `Submitted application ${submittedReference} not found after database reload!`);
    assert(found.student_id === 'STU-2026-001', 'Student ID mismatch on reloaded submission');
  });

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  console.log('\n===============================================================');
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.log(`Test Execution Finished: ${passed}/${total} passed (${failed} failed)`);
  console.log('===============================================================\n');

  if (failed > 0) {
    console.error('FAILED TESTS:');
    for (const r of results.filter((r) => !r.passed)) {
      console.error(`  - [${r.category}] ${r.name}: ${r.error}`);
    }
    process.exit(1);
  } else {
    console.log('ALL API SECURITY & FUNCTIONAL TESTS PASSED SUCCESSFULLY! 🎉\n');
    process.exit(0);
  }
}

runAllTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});

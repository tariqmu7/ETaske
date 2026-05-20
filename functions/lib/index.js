"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.onAnnouncementCreated = exports.onNotificationCreated = void 0;
const functions = __importStar(require("firebase-functions/v2"));
const admin = __importStar(require("firebase-admin"));
admin.initializeApp();
const DB_ID = 'ai-studio-82d500c4-619e-4632-9bd3-9466532da5e6';
const db = admin.firestore();
db.settings({ databaseId: DB_ID });
// ─── Helpers ──────────────────────────────────────────────────────────────────
async function getFcmToken(uid) {
    var _a, _b;
    const snap = await db.collection('users').doc(uid).get();
    return (_b = (_a = snap.data()) === null || _a === void 0 ? void 0 : _a.fcmToken) !== null && _b !== void 0 ? _b : null;
}
async function sendPush(token, title, body) {
    var _a;
    try {
        await admin.messaging().send({
            token,
            notification: { title, body },
            android: { priority: 'high' },
            webpush: {
                notification: { icon: '/favicon.png', badge: '/favicon.png' },
                fcmOptions: { link: '/' },
            },
        });
    }
    catch (err) {
        // Token stale / unregistered — clear it so we don't retry
        const code = (_a = err.code) !== null && _a !== void 0 ? _a : '';
        if (code === 'messaging/registration-token-not-registered' ||
            code === 'messaging/invalid-registration-token') {
            // Fire-and-forget cleanup; ignore failure
            db.collection('users').where('fcmToken', '==', token).get().then((q) => {
                q.forEach((d) => d.ref.update({ fcmToken: admin.firestore.FieldValue.delete() }));
            }).catch(() => undefined);
        }
        else {
            console.error('FCM send error:', err);
        }
    }
}
// ─── Trigger: new notification doc ────────────────────────────────────────────
// Fires when any document is created in the notifications collection.
// Sends a push to the forUserId's device if they have an FCM token.
exports.onNotificationCreated = functions.firestore.onDocumentCreated({
    document: 'notifications/{notifId}',
    database: DB_ID,
    region: 'us-central1',
}, async (event) => {
    var _a, _b, _c, _d;
    const data = (_a = event.data) === null || _a === void 0 ? void 0 : _a.data();
    if (!data)
        return;
    const forUserId = (_b = data.forUserId) !== null && _b !== void 0 ? _b : '';
    const title = (_c = data.title) !== null && _c !== void 0 ? _c : 'ETaske';
    const message = (_d = data.message) !== null && _d !== void 0 ? _d : '';
    if (!forUserId)
        return;
    const token = await getFcmToken(forUserId);
    if (!token)
        return;
    await sendPush(token, title, message);
});
// ─── Trigger: new announcement doc ────────────────────────────────────────────
// Fires when an announcement is created. Sends a push to every Approved user
// in the target department (or the explicit recipientIds list).
exports.onAnnouncementCreated = functions.firestore.onDocumentCreated({
    document: 'announcements/{announcementId}',
    database: DB_ID,
    region: 'us-central1',
}, async (event) => {
    var _a, _b, _c, _d, _e, _f;
    const data = (_a = event.data) === null || _a === void 0 ? void 0 : _a.data();
    if (!data)
        return;
    const title = `إعلان من ${(_b = data.authorName) !== null && _b !== void 0 ? _b : 'ETaske'}`;
    const body = (_d = (_c = data.text) === null || _c === void 0 ? void 0 : _c.slice(0, 200)) !== null && _d !== void 0 ? _d : '';
    const department = (_e = data.department) !== null && _e !== void 0 ? _e : '';
    const recipientIds = Array.isArray(data.recipientIds) ? data.recipientIds : [];
    const authorId = (_f = data.authorId) !== null && _f !== void 0 ? _f : '';
    let targetUids;
    if (recipientIds.length > 0) {
        // Explicit recipient list (+ author excluded — they sent it)
        targetUids = recipientIds.filter((uid) => uid !== authorId);
    }
    else {
        // Dept-wide: all Approved users in the same department
        const usersSnap = await db
            .collection('users')
            .where('status', '==', 'Approved')
            .where('department', '==', department)
            .get();
        targetUids = usersSnap.docs
            .map((d) => d.id)
            .filter((uid) => uid !== authorId);
    }
    if (targetUids.length === 0)
        return;
    // Fetch tokens for all targets in parallel
    const tokens = await Promise.all(targetUids.map(getFcmToken));
    await Promise.all(tokens.map((token) => {
        if (!token)
            return Promise.resolve();
        return sendPush(token, title, body);
    }));
});
//# sourceMappingURL=index.js.map
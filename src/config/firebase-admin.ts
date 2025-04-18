import dotenv from 'dotenv'
import * as admin from 'firebase-admin'
dotenv.config()

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
    })
}

export const adminDb = admin.firestore()
export const auth = admin.auth()

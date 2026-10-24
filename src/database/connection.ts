import mysql from 'mysql2/promise';

const dbHost = process.env.DB_HOST || 'localhost';
const dbPort = Number(process.env.DB_PORT || 3306);

if (!Number.isInteger(dbPort) || dbPort < 1 || dbPort > 65535) {
    throw new Error('DB_PORT harus berupa nomor port antara 1 dan 65535.');
}

export const databaseEndpoint = `${dbHost}:${dbPort}`;

export const db = mysql.createPool({
    host:               dbHost,
    port:               dbPort,
    user:               process.env.DB_USER,
    password:           process.env.DB_PASSWORD,
    database:           process.env.DB_NAME || 'shorekeeper_db',
    connectTimeout:     10_000,
    waitForConnections: true,
    connectionLimit:    10,
    queueLimit:         0,
});

/** Memastikan koneksi database dapat dipakai dengan melakukan ping. */
export const verifyDatabaseConnection = async (): Promise<void> => {
    const connection = await db.getConnection();
    try {
        await connection.ping();
    } finally {
        connection.release();
    }
};
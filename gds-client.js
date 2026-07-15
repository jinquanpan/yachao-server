const axios = require("axios");
const mysql = require("mysql2/promise");
require("dotenv").config();

const GDS_API_URL =
    "https://bff.gds.org.cn/gds/searching-api/ProductService/ProductListByGTIN";

const dbPool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,

    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,

    charset: "utf8mb4"
});

/**
 * 对日志中的敏感信息进行脱敏。
 */
function maskToken(token) {
    if (!token || token.length < 20) {
        return "[REDACTED]";
    }

    return `${token.slice(0, 8)}...${token.slice(-6)}`;
}

/**
 * 将 13 位 EAN-13 转成 GDS 接口常见的 14 位 GTIN。
 *
 * 示例：
 * 6921311105168
 * 转换：
 * 06921311105168
 */
function normalizeGtin(barcode) {
    const value = String(barcode || "").trim();

    if (!/^\d+$/.test(value)) {
        throw new Error("条形码只能包含数字");
    }

    if (value.length === 13) {
        return `0${value}`;
    }

    if (value.length === 14) {
        return value;
    }

    throw new Error("当前接口只接受 13 位或 14 位 GTIN");
}

/**
 * 从数据库读取有效的 GDS Token。
 */
async function getGdsAuthFromDatabase(account) {
    const sql = `
    SELECT
      id,
      account,
      access_token,
      current_role,
      expires_at
    FROM gds_auth
    WHERE account = ?
      AND status = 1
      AND (
        expires_at IS NULL
        OR expires_at > NOW()
      )
    ORDER BY updated_at DESC
    LIMIT 1
  `;

    const [rows] = await dbPool.execute(sql, [account]);

    if (!rows.length) {
        throw new Error("数据库中没有找到有效的 GDS Access Token");
    }

    const auth = rows[0];

    if (!auth.access_token) {
        throw new Error("数据库中的 GDS Access Token 为空");
    }

    return {
        id: auth.id,
        account: auth.account,
        accessToken: auth.access_token.trim(),
        currentRole: auth.current_role || "Mine",
        expiresAt: auth.expires_at
    };
}

/**
 * 查询 GDS 商品信息。
 */
async function queryGdsProductByBarcode(barcode, options = {}) {
    const {
        pageSize = 30,
        pageIndex = 1,
        account = process.env.GDS_ACCOUNT
    } = options;

    if (!account) {
        throw new Error("未配置 GDS_ACCOUNT");
    }

    const gtin = normalizeGtin(barcode);
    const auth = await getGdsAuthFromDatabase(account);

    try {
        const response = await axios.get(GDS_API_URL, {
            params: {
                PageSize: pageSize,
                PageIndex: pageIndex,
                SearchItem: gtin
            },

            headers: {
                Authorization: `Bearer ${auth.accessToken}`,
                currentRole: auth.currentRole,
                Accept: "application/json"
            },

            timeout: 15000,

            // 让 axios 不对非 2xx 状态直接抛异常，
            // 便于统一读取接口返回内容。
            validateStatus: () => true
        });

        if (response.status === 401) {
            return {
                success: false,
                code: "GDS_TOKEN_EXPIRED",
                message: "GDS 登录状态已失效，需要重新登录并更新数据库 Token",
                barcode,
                gtin,
                httpStatus: response.status,
                data: response.data
            };
        }

        if (response.status === 403) {
            return {
                success: false,
                code: "GDS_FORBIDDEN",
                message: "当前账号或角色没有查询权限",
                barcode,
                gtin,
                httpStatus: response.status,
                data: response.data
            };
        }

        if (response.status < 200 || response.status >= 300) {
            return {
                success: false,
                code: "GDS_HTTP_ERROR",
                message: `GDS 接口请求失败，HTTP ${response.status}`,
                barcode,
                gtin,
                httpStatus: response.status,
                data: response.data
            };
        }

        return {
            success: true,
            barcode,
            gtin,
            pageIndex,
            pageSize,
            httpStatus: response.status,

            // 原样返回 GDS 数据。
            data: response.data
        };
    } catch (error) {
        return {
            success: false,
            code: "GDS_REQUEST_ERROR",
            message:
                error.code === "ECONNABORTED"
                    ? "GDS 接口请求超时"
                    : error.message,
            barcode,
            gtin
        };
    } finally {
        console.log(
            `[GDS] account=${account}, token=${maskToken(auth.accessToken)}, gtin=${gtin}`
        );
    }
}

async function closeDatabase() {
    await dbPool.end();
}

module.exports = {
    queryGdsProductByBarcode,
    getGdsAuthFromDatabase,
    normalizeGtin,
    closeDatabase
};

/**
 * 命令行测试：
 *
 * node gds-client.js 6921311105168
 */
if (require.main === module) {
    const barcode = process.argv[2];

    queryGdsProductByBarcode(barcode)
        .then((result) => {
            console.log(JSON.stringify(result, null, 2));
        })
        .catch((error) => {
            console.error(
                JSON.stringify(
                    {
                        success: false,
                        message: error.message
                    },
                    null,
                    2
                )
            );

            process.exitCode = 1;
        })
        .finally(async () => {
            await closeDatabase();
        });
}
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeInMemoryStore,
    jidDecode
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const { Boom } = require("@hapi/boom");
const qr = require("qrcode-terminal");

// إعداد لتخزين معلومات الجلسة (لتجنب إعادة تسجيل الدخول في كل مرة)
const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) });

async function connectToWhatsApp() {
    // سيتم إنشاء مجلد باسم 'auth_info_baileys' لتخزين بيانات الجلسة
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Using WA v${version.join('.')}, isLatest: ${isLatest}`);

    const sock = makeWASocket({
        version,
        logger: pino({ level: "silent" }),
        printQRInTerminal: true,
        auth: state,
        browser: ['ManusBot', 'Safari', '1.0.0']
    });

    store.bind(sock.ev);

    // معالجة تحديثات الاتصال (لإظهار QR أو إعادة الاتصال)
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            // عرض رمز QR في السجلات
            qr.generate(qr, { small: true });
            console.log("امسح رمز QR هذا باستخدام واتساب على هاتفك:");
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connection closed due to ', lastDisconnect.error, ', reconnecting ', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('تم الاتصال بنجاح!');
        }
    });

    // حفظ بيانات الاعتماد عند تحديثها
    sock.ev.on('creds.update', saveCreds);

    // الاستماع للرسائل الجديدة
    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0];
        if (!msg.message) return;

        const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text;
        const from = msg.key.remoteJid;

        // التحقق مما إذا كانت الرسالة من مجموعة وأنها الأمر المطلوب
        if (msg.key.remoteJid.endsWith('@g.us') && messageText && messageText.toLowerCase() === '.منشن') {
            console.log(`تم استقبال أمر .منشن في المجموعة: ${from}`);

            try {
                // جلب بيانات المجموعة (بما في ذلك المشاركين)
                const groupMetadata = await sock.groupMetadata(from);
                const participants = groupMetadata.participants;

                // إنشاء نص المنشن
                let text = "تم استدعاء الجميع!\n\n";
                let mentions = [];

                for (let participant of participants) {
                    // إضافة @ ورقم الهاتف بدون @s.whatsapp.net
                    const participantJid = participant.id;
                    text += `@${participantJid.split('@')[0]}\n`;
                    mentions.push(participantJid);
                }

                // إرسال الرسالة مع المنشن
                await sock.sendMessage(from, { text: text, mentions: mentions });
                console.log("تم إرسال المنشن بنجاح.");

            } catch (err) {
                console.error("حدث خطأ أثناء محاولة عمل المنشن:", err);
                await sock.sendMessage(from, { text: "عذراً، حدث خطأ ولم أتمكن من عمل المنشن." });
            }
        }
    });
}

// بدء تشغيل البوت
connectToWhatsApp();

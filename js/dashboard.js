import { auth, db } from "./firebase.js";
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { doc, getDoc, setDoc, collection, addDoc, query, where, getDocs, updateDoc, onSnapshot, deleteDoc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// --- SWEETALERT AYARLARI ---
const Toast = Swal.mixin({ background: '#ffffff', color: '#1e293b', confirmButtonColor: '#0ea5e9', cancelButtonColor: '#ef4444' });

// --- GLOBAL DEĞİŞKENLER VE DOM ELEMENTLERİ ---
const sidebar = document.getElementById('sidebar');
const toggleBtn = document.getElementById('sidebar-toggle');
const overlay = document.getElementById('sidebar-overlay');
const businessNameEl = document.getElementById('business-name');
const profileInitialEl = document.getElementById('profile-initial');

const accordionBtn = document.getElementById('profile-accordion-btn');
const accordionContent = document.getElementById('profile-accordion-content');
const progressBarFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');

let currentUserSlug = "link";

// --- HARİTA DEĞİŞKENLERİ ---
let map = null;
let marker = null;
let currentLat = 37.2153; // Default Muğla Merkez Enlem
let currentLng = 28.3636; // Default Muğla Merkez Boylam

// --- GALERİ DEĞİŞKENLERİ ---
let businessGallery = [];
const MAX_GALLERY = 10;

// --- RBAC (ROL KONTROLÜ) SİSTEMİ ---
const activeRoleData = JSON.parse(localStorage.getItem("activeRole"));
const isPersonnelMode = activeRoleData && activeRoleData.role === "personnel";
const targetBusinessUid = isPersonnelMode ? activeRoleData.businessUid : null;
const loggedInPersonnelName = isPersonnelMode ? activeRoleData.name : null;

function generateSlug(text) {
    const trMap = { 'ç': 'c', 'ğ': 'g', 'ş': 's', 'ü': 'u', 'ı': 'i', 'ö': 'o', 'Ç': 'C', 'Ğ': 'G', 'Ş': 'S', 'Ü': 'U', 'İ': 'I', 'Ö': 'O' };
    for (let key in trMap) { text = text.replace(new RegExp(key, 'g'), trMap[key]); }
    return text.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function cleanPhone(phoneStr) {
    if (!phoneStr) return '';
    return String(phoneStr).replace(/\D/g, '');
}

// --- 1. MENÜ VE YÖNLENDİRME ---
function toggleSidebar() {
    if (window.innerWidth <= 768) { sidebar.classList.toggle('mobile-open'); overlay.classList.toggle('active'); }
    else { sidebar.classList.toggle('collapsed'); }
}
toggleBtn.addEventListener('click', toggleSidebar);
overlay.addEventListener('click', toggleSidebar);

const navLinks = document.querySelectorAll('.nav-links a');
const sections = document.querySelectorAll('.content-section');

navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelectorAll('.nav-links li').forEach(li => li.classList.remove('active'));
        sections.forEach(sec => sec.classList.remove('active'));

        link.parentElement.classList.add('active');
        document.getElementById(link.getAttribute('data-target')).classList.add('active');

        if (window.innerWidth <= 768) { toggleSidebar(); }
    });
});

// --- YENİ EKLENEN: HARİTA BAŞLATMA (LEAFLET) ---
function initMap() {
    if (map) return;
    if (!document.getElementById('business-map')) return;

    map = L.map('business-map').setView([currentLat, currentLng], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    marker = L.marker([currentLat, currentLng], { draggable: true }).addTo(map);

    map.on('click', function (e) {
        currentLat = e.latlng.lat;
        currentLng = e.latlng.lng;
        marker.setLatLng(e.latlng);
    });

    marker.on('dragend', function () {
        const pos = marker.getLatLng();
        currentLat = pos.lat;
        currentLng = pos.lng;
    });
}

// GPS İLE BUL BUTONU (Yüksek Hassasiyet Zırhlı)
const findMeBtn = document.getElementById('find-me-btn');
if (findMeBtn) {
    findMeBtn.addEventListener('click', () => {
        if (navigator.geolocation) {
            Swal.fire({ title: 'GPS Aranıyor...', text: 'Tarayıcıdan konum izni vermeniz gerekebilir.', didOpen: () => Swal.showLoading() });

            navigator.geolocation.getCurrentPosition((position) => {
                Swal.close();
                currentLat = position.coords.latitude;
                currentLng = position.coords.longitude;
                if (map && marker) {
                    map.setView([currentLat, currentLng], 16);
                    marker.setLatLng([currentLat, currentLng]);
                }
                Toast.fire({ icon: 'success', title: 'Konum bulundu!' });
            }, (err) => {
                Swal.fire({ icon: 'error', title: 'Hata', text: 'Konum izni reddedildi veya bulunamadı.' });
            }, {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            });
        }
    });
}

// --- 2. CANLI BİLDİRİM FONKSİYONU (Titreşimli PWA) ---
function listenForNewAppointments(uid) {
    let isInitialLoad = true;
    const pendingQuery = query(collection(db, "businesses", uid, "appointments"), where("status", "==", "pending"));

    onSnapshot(pendingQuery, (snapshot) => {
        if (isInitialLoad) { isInitialLoad = false; return; }
        snapshot.docChanges().forEach((change) => {
            if (change.type === "added") {
                const newApp = change.doc.data();
                if (isPersonnelMode && newApp.personnelName !== loggedInPersonnelName && newApp.personnelName !== "") { return; }

                const bell = document.getElementById('notification-bell');
                if (bell) { bell.currentTime = 0; bell.play().catch(e => console.log("Ses çalma izni yok:", e)); }

                if ("Notification" in window && Notification.permission === "granted") {
                    navigator.serviceWorker.ready.then((registration) => {
                        registration.showNotification("🔔 Yeni Randevu Talebi!", {
                            body: `${newApp.clientName || 'Bir müşteri'} randevu oluşturdu.`,
                            icon: "https://cdn-icons-png.flaticon.com/512/2838/2838779.png",
                            vibrate: [200, 100, 200, 100, 200],
                            tag: "new-appointment",
                            renotify: true
                        });
                    });
                } else {
                    Toast.fire({ icon: 'info', title: `🔔 Yeni Randevu Geldi` });
                }

                if (!isPersonnelMode) { loadDashboardAndCRM(); }
                generateTimeSlots();
            }
        });
    });
}

// --- 3. OTURUM KONTROLÜ VE YETKİLENDİRME ---
onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.replace("index.html"); }
    else {
        try {
            const uidToFetch = isPersonnelMode ? targetBusinessUid : user.uid;
            const docRef = doc(db, "businesses", uidToFetch);
            const docSnap = await getDoc(docRef);

            if (!docSnap.exists() || docSnap.data().businessName === "Yeni İşletme") {
                if (!isPersonnelMode) { askForBusinessInfo(docRef, user); }
            } else {
                const data = docSnap.data();
                currentUserSlug = data.slug || generateSlug(data.businessName);

                if (isPersonnelMode) {
                    updateUI(data.businessName + " | 👤 " + loggedInPersonnelName);
                    const overviewTab = document.querySelector('[data-target="section-overview"]'); if (overviewTab) overviewTab.parentElement.style.display = 'none';
                    const clientsTab = document.querySelector('[data-target="section-clients"]'); if (clientsTab) clientsTab.parentElement.style.display = 'none';
                    const reviewsTab = document.querySelector('[data-target="section-reviews"]'); if (reviewsTab) reviewsTab.parentElement.style.display = 'none';
                    const settingsTab = document.querySelector('[data-target="section-settings"]'); if (settingsTab) settingsTab.parentElement.style.display = 'none';
                    const quickActions = document.querySelector('.quick-actions-row'); if (quickActions) quickActions.style.display = 'none';
                    document.querySelector('[data-target="section-appointments"]').click();
                } else {
                    updateUI(data.businessName);
                    updateProfileSection(data);
                    loadDashboardAndCRM();
                    loadReviews();
                    loadGallery(uidToFetch);
                }

                fetchBusinessSettings(uidToFetch);
                listenForNewAppointments(uidToFetch);
            }
        } catch (error) { console.error("Veri çekme hatası:", error); }
    }
});

async function askForBusinessInfo(docRef, user) {
    const { value: formValues } = await Swal.fire({
        title: 'Panele Hoş Geldiniz! 🚀',
        html: `
            <p style="font-size: 0.9rem; color: #64748b; margin-bottom: 25px;">Lütfen işletme bilgilerinizi tamamlayın.</p>
            <input id="swal-bname" class="swal-custom-input" placeholder="İşletme Adı (Örn: Aziz Kuaför)" required>
            <div class="swal-phone-group">
                <span class="swal-phone-prefix">+90</span>
                <input id="swal-phone" class="swal-phone-input" placeholder="5XX XXX XX XX" type="tel" maxlength="10">
            </div>
        `,
        focusConfirm: false, allowOutsideClick: false, allowEscapeKey: false, confirmButtonText: 'Kaydet ve Başla',
        preConfirm: () => {
            const bName = document.getElementById('swal-bname').value; const bPhoneRaw = document.getElementById('swal-phone').value;
            if (!bName) { Swal.showValidationMessage('İşletme adı zorunludur!'); return false; }
            if (bPhoneRaw.length < 10) { Swal.showValidationMessage('Geçerli telefon girin!'); return false; }
            return { bName, formattedPhone: "+90" + bPhoneRaw.replace(/\s+/g, ''), slug: generateSlug(bName) };
        }
    });

    if (formValues) {
        currentUserSlug = formValues.slug;
        await setDoc(docRef, { businessName: formValues.bName, phone: formValues.formattedPhone, slug: formValues.slug }, { merge: true });
        updateUI(formValues.bName);
        updateProfileSection({ businessName: formValues.bName, phone: formValues.formattedPhone });
        Toast.fire({ icon: 'success', title: 'Bilgiler kaydedildi!' });

        fetchBusinessSettings(user.uid);
        loadDashboardAndCRM();
        loadReviews();
        loadGallery(user.uid);
        listenForNewAppointments(user.uid);
    }
}

function updateUI(businessName) {
    if (businessNameEl) businessNameEl.textContent = businessName;
    if (profileInitialEl) profileInitialEl.textContent = businessName.charAt(0).toUpperCase();
    const slugDisplay = document.getElementById('display-business-slug');
    if (slugDisplay) { slugDisplay.textContent = currentUserSlug; }
}

const copyLinkBtn = document.getElementById('copy-link-btn');
if (copyLinkBtn) {
    copyLinkBtn.addEventListener('click', () => {
        const shopLink = `https://muglaburadaa.web.app/index.html?isletme=${currentUserSlug}`;
        navigator.clipboard.writeText(shopLink).then(() => {
            copyLinkBtn.innerHTML = "✅ Kopyalandı!"; setTimeout(() => { copyLinkBtn.innerHTML = "🔗 Linkimi Kopyala"; }, 2000);
            Toast.fire({ icon: 'success', title: 'Vitrin linki kopyalandı!' });
        });
    });
}

const copySlugBtn = document.getElementById('copy-slug-btn');
if (copySlugBtn) {
    copySlugBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(currentUserSlug).then(() => {
            const originalHtml = copySlugBtn.innerHTML; copySlugBtn.innerHTML = "✅ Kopyalandı!"; setTimeout(() => { copySlugBtn.innerHTML = originalHtml; }, 2000);
            Toast.fire({ icon: 'success', title: 'Personel Giriş Kodu Kopyalandı!' });
        });
    });
}

// --- 4. PROFİL AYARLARI ---
if (accordionBtn) {
    accordionBtn.addEventListener('click', () => {
        accordionBtn.classList.toggle('active');
        accordionContent.classList.toggle('active');

        if (accordionContent.classList.contains('active')) {
            setTimeout(() => {
                initMap();
                if (map) map.invalidateSize();
            }, 300);
        }
    });
}

function updateProfileSection(data) {
    if (!document.getElementById('setting-bname')) return;

    document.getElementById('setting-bname').value = data.businessName || "";
    document.getElementById('setting-phone').value = data.phone || "";
    document.getElementById('setting-address').value = data.address || "";

    if (data.logoBase64) {
        document.getElementById('logo-preview').style.backgroundImage = `url(${data.logoBase64})`;
        document.getElementById('logo-placeholder').style.display = 'none';
    }

    if (data.lat && data.lng) {
        currentLat = data.lat;
        currentLng = data.lng;
        if (map && marker) {
            map.setView([currentLat, currentLng], 15);
            marker.setLatLng([currentLat, currentLng]);
        }
    }

    let score = 0;
    if (data.businessName) score += 20; if (data.phone) score += 20; if (data.address) score += 20; if (data.logoBase64) score += 20;
    if (data.lat) score += 20;
    progressBarFill.style.width = `${score}%`; progressText.textContent = `%${score}`;
}

let tempLogoBase64 = null;
const triggerLogoBtn = document.getElementById('trigger-logo-btn');
const logoUpload = document.getElementById('logo-upload');

if (triggerLogoBtn && logoUpload) {
    triggerLogoBtn.addEventListener('click', () => logoUpload.click());
    logoUpload.addEventListener('change', function (e) {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function (event) {
                tempLogoBase64 = event.target.result;
                document.getElementById('logo-preview').style.backgroundImage = `url(${tempLogoBase64})`;
                document.getElementById('logo-placeholder').style.display = 'none';
            };
            reader.readAsDataURL(file);
        }
    });
}

const saveProfileBtn = document.getElementById('save-profile-btn');
if (saveProfileBtn) {
    saveProfileBtn.addEventListener('click', async () => {
        const bName = document.getElementById('setting-bname').value;
        const phone = document.getElementById('setting-phone').value;
        const address = document.getElementById('setting-address').value;

        if (!bName || !phone) { return Toast.fire({ icon: 'error', title: 'İşletme Adı ve Telefon zorunludur!' }); }

        const originalText = saveProfileBtn.textContent; saveProfileBtn.textContent = "Güncelleniyor..."; saveProfileBtn.disabled = true;

        try {
            const user = auth.currentUser;
            if (user) {
                const docRef = doc(db, "businesses", user.uid);
                const newSlug = generateSlug(bName);
                currentUserSlug = newSlug;

                const updateData = { businessName: bName, phone: phone, address: address, slug: newSlug, lat: currentLat, lng: currentLng };
                if (tempLogoBase64) { updateData.logoBase64 = tempLogoBase64; }

                await setDoc(docRef, updateData, { merge: true });
                updateUI(bName);
                const docSnap = await getDoc(docRef); updateProfileSection(docSnap.data());
                Toast.fire({ icon: 'success', title: 'Profil güncellendi!' });
            }
        } catch (error) { Toast.fire({ icon: 'error', title: 'Güncellenirken hata oluştu!' }); } finally { saveProfileBtn.textContent = originalText; saveProfileBtn.disabled = false; }
    });
}

const savePasswordBtn = document.getElementById('save-password-btn');
if (savePasswordBtn) {
    savePasswordBtn.addEventListener('click', async () => {
        const oldPass = document.getElementById('setting-old-pass').value;
        const newPass = document.getElementById('setting-new-pass').value;

        if (!oldPass || !newPass) { return Toast.fire({ icon: 'error', title: 'Eski ve yeni şifrenizi girin!' }); }
        if (newPass.length < 6) { return Toast.fire({ icon: 'warning', title: 'Yeni şifre en az 6 karakter olmalıdır!' }); }

        const user = auth.currentUser;
        if (user) {
            const originalText = savePasswordBtn.textContent; savePasswordBtn.textContent = "Güncelleniyor..."; savePasswordBtn.disabled = true;
            try {
                const credential = EmailAuthProvider.credential(user.email, oldPass);
                await reauthenticateWithCredential(user, credential);

                await updatePassword(user, newPass);

                // DÜZELTME: Veritabanındaki şifre de güncellenir
                const docRef = doc(db, "businesses", user.uid);
                await setDoc(docRef, { plainPassword: newPass }, { merge: true });

                Toast.fire({ icon: 'success', title: 'Şifreniz başarıyla güncellendi!' });
                document.getElementById('setting-old-pass').value = ''; document.getElementById('setting-new-pass').value = '';
            } catch (error) {
                if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password') { Toast.fire({ icon: 'error', title: 'Mevcut şifrenizi hatalı girdiniz!' }); } else { Toast.fire({ icon: 'error', title: 'Şifre güncellenirken hata oluştu!' }); }
            } finally { savePasswordBtn.textContent = originalText; savePasswordBtn.disabled = false; }
        }
    });
}

// --- GALERİ YÖNETİMİ ---
function compressImage(file, maxSize = 800) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width; let height = img.height;

                if (width > height) { if (width > maxSize) { height *= maxSize / width; width = maxSize; } }
                else { if (height > maxSize) { width *= maxSize / height; height = maxSize; } }

                canvas.width = width; canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.7));
            };
        };
    });
}

async function loadGallery(uid) {
    try {
        const q = query(collection(db, "businesses", uid, "gallery"));
        const snap = await getDocs(q);
        businessGallery = [];
        snap.forEach(d => { businessGallery.push({ id: d.id, ...d.data() }); });
        businessGallery.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        renderGalleryUI();
    } catch (e) { console.error("Galeri yüklenemedi", e); }
}

function renderGalleryUI() {
    const grid = document.getElementById('gallery-grid');
    const countText = document.getElementById('gallery-count');
    if (!grid) return;

    countText.textContent = `${businessGallery.length}/${MAX_GALLERY}`;

    if (businessGallery.length === 0) {
        grid.innerHTML = '<p class="empty-list" style="grid-column: 1/-1;">Henüz galeriye fotoğraf eklemediniz.</p>';
        return;
    }

    grid.innerHTML = businessGallery.map((img, idx) => `
        <div class="gallery-item" style="background-image: url(${img.image});">
            <button class="gallery-delete-btn" onclick="deleteGalleryImage(${idx})" title="Sil">✕</button>
        </div>
    `).join('');
}

const triggerGalleryBtn = document.getElementById('trigger-gallery-btn');
const galleryUpload = document.getElementById('gallery-upload');
if (triggerGalleryBtn && galleryUpload) {
    triggerGalleryBtn.addEventListener('click', () => {
        if (businessGallery.length >= MAX_GALLERY) {
            Toast.fire({ icon: 'warning', title: `En fazla ${MAX_GALLERY} fotoğraf yükleyebilirsiniz!` });
            return;
        }
        galleryUpload.click();
    });

    galleryUpload.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            if (businessGallery.length >= MAX_GALLERY) {
                Toast.fire({ icon: 'warning', title: `Maksimum sınıra (${MAX_GALLERY}) ulaştınız!` });
                return;
            }

            Swal.fire({ title: 'Sıkıştırılıp Yükleniyor...', didOpen: () => Swal.showLoading() });
            try {
                const base64Data = await compressImage(file, 800);
                const uid = isPersonnelMode ? targetBusinessUid : auth.currentUser.uid;

                const docRef = await addDoc(collection(db, "businesses", uid, "gallery"), {
                    image: base64Data,
                    createdAt: new Date().toISOString()
                });

                businessGallery.push({ id: docRef.id, image: base64Data, createdAt: new Date().toISOString() });
                businessGallery.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                renderGalleryUI();
                Toast.fire({ icon: 'success', title: 'Fotoğraf başarıyla eklendi!' });
            } catch (err) {
                console.error(err); Toast.fire({ icon: 'error', title: 'Yükleme başarısız!' });
            }
            galleryUpload.value = '';
        }
    });
}

window.deleteGalleryImage = async (idx) => {
    const imgData = businessGallery[idx];
    const confirm = await Swal.fire({
        title: 'Silmek istiyor musunuz?',
        text: "Bu fotoğraf galeriden kalıcı olarak silinecek.",
        icon: 'warning',
        showCancelButton: true, confirmButtonText: 'Evet, Sil', cancelButtonText: 'İptal', confirmButtonColor: '#ef4444'
    });

    if (confirm.isConfirmed) {
        Swal.fire({ title: 'Siliniyor...', didOpen: () => Swal.showLoading() });
        try {
            const uid = isPersonnelMode ? targetBusinessUid : auth.currentUser.uid;
            await deleteDoc(doc(db, "businesses", uid, "gallery", imgData.id));
            businessGallery.splice(idx, 1);
            renderGalleryUI();
            Toast.fire({ icon: 'success', title: 'Fotoğraf silindi!' });
        } catch (err) { Toast.fire({ icon: 'error', title: 'Silinemedi!' }); }
    }
};

// --- 5. İŞLETME SETTINGS, MESAİ, PERSONEL VE HİZMET YÖNETİMİ ---
const daysOfWeek = [
    { id: 'monday', name: 'Pazartesi' }, { id: 'tuesday', name: 'Salı' }, { id: 'wednesday', name: 'Çarşamba' },
    { id: 'thursday', name: 'Perşembe' }, { id: 'friday', name: 'Cuma' }, { id: 'saturday', name: 'Cumartesi' }, { id: 'sunday', name: 'Pazar' }
];

let businessSchedule = {}; let businessServices = []; let businessHolidays = []; let businessPersonnel = [];

function renderScheduleUI() {
    const container = document.getElementById('schedule-container'); if (!container) return; container.innerHTML = '';
    daysOfWeek.forEach(day => {
        if (!businessSchedule[day.id]) { businessSchedule[day.id] = { active: (day.id !== 'sunday'), start: '09:00', end: '18:00', breaks: [] }; }
        const data = businessSchedule[day.id];

        const breaksHTML = data.breaks.map((br, index) => `
            <div class="break-badge">☕ ${br.start} - ${br.end} <span class="remove-break" onclick="removeBreak('${day.id}', ${index})">✕</span></div>
        `).join('');

        container.insertAdjacentHTML('beforeend', `
            <div class="day-row ${data.active ? 'active' : ''}" id="row-${day.id}">
                <div class="day-main">
                    <div class="day-info">
                        <label class="switch"><input type="checkbox" onchange="toggleDay('${day.id}')" ${data.active ? 'checked' : ''}><span class="slider"></span></label>
                        <div><div class="day-name">${day.name}</div><div class="day-status">${data.active ? 'Açık' : 'Kapalı'}</div></div>
                    </div>
                    <div class="time-group">
                        <input type="time" class="time-input" value="${data.start}" onchange="updateTime('${day.id}', 'start', this.value)"> <span>-</span>
                        <input type="time" class="time-input" value="${data.end}" onchange="updateTime('${day.id}', 'end', this.value)">
                        <button class="break-btn" onclick="openBreakModal('${day.id}', '${day.name}')">+ Mola</button>
                    </div>
                </div>
                <div class="breaks-container" id="breaks-${day.id}">${breaksHTML}</div>
            </div>
        `);
    });
    renderServicesUI(); renderHolidaysUI(); renderPersonnelUI();
}

function renderServicesUI() {
    const list = document.getElementById('services-list'); if (!list) return;
    list.innerHTML = businessServices.map((srv, idx) => `
        <div class="break-badge" style="background:#f0fdf4; border-color:#bbf7d0; color:#16a34a; cursor:pointer;" onclick="editService(${idx})">
            🏷️ ${srv.name} <span>(${srv.duration} Dk)</span> 
            <span class="service-price-badge">${srv.price ? srv.price + ' ₺' : 'Ücretsiz'}</span> 
            <span class="remove-break" onclick="event.stopPropagation(); removeService(${idx})">✕</span>
        </div>
    `).join('');
}

window.editService = async (idx) => {
    const srv = businessServices[idx];
    const { value: formValues } = await Swal.fire({
        title: 'Hizmeti Güncelle',
        html: `
            <div style="text-align:left;">
                <label style="font-size:0.85rem; color:#64748b;">Hizmet Adı</label>
                <input type="text" id="edit-service-name" class="modern-input" value="${srv.name}" style="margin-bottom:15px; padding:10px;">
                
                <div style="display:flex; gap:10px;">
                    <div style="flex:1;">
                        <label style="font-size:0.85rem; color:#64748b;">Süre (Dk)</label>
                        <input type="number" id="edit-service-duration" class="modern-input" value="${srv.duration}" style="padding:10px;">
                    </div>
                    <div style="flex:1;">
                        <label style="font-size:0.85rem; color:#64748b;">Fiyat (₺)</label>
                        <input type="number" id="edit-service-price" class="modern-input" value="${srv.price}" style="padding:10px;">
                    </div>
                </div>
            </div>
        `,
        focusConfirm: false, showCancelButton: true, confirmButtonText: 'Güncelle', cancelButtonText: 'İptal',
        preConfirm: () => {
            const name = document.getElementById('edit-service-name').value;
            const duration = document.getElementById('edit-service-duration').value;
            const price = document.getElementById('edit-service-price').value;
            if (!name || !duration) { Swal.showValidationMessage('Ad ve Süre zorunludur!'); return false; }
            return { name, duration: parseInt(duration), price: price ? parseInt(price) : 0 };
        }
    });

    if (formValues) {
        businessServices[idx] = formValues; renderServicesUI(); Toast.fire({ icon: 'success', title: 'Hizmet güncellendi!' });
    }
};

const addServiceBtn = document.getElementById('add-service-btn');
if (addServiceBtn) {
    addServiceBtn.addEventListener('click', () => {
        const nameInput = document.getElementById('new-service-name'); const durationInput = document.getElementById('new-service-duration'); const priceInput = document.getElementById('new-service-price');
        if (nameInput.value.trim() !== '' && durationInput.value.trim() !== '') {
            businessServices.push({ name: nameInput.value.trim(), duration: parseInt(durationInput.value), price: priceInput.value ? parseInt(priceInput.value) : 0 });
            nameInput.value = ''; durationInput.value = ''; priceInput.value = ''; renderServicesUI();
        } else { Toast.fire({ icon: 'warning', title: 'Hizmet adı ve süresi zorunludur!' }); }
    });
}
window.removeService = (idx) => { businessServices.splice(idx, 1); renderServicesUI(); };

function renderPersonnelUI() {
    const list = document.getElementById('personnel-list'); if (!list) return;
    if (businessPersonnel.length === 0) { list.innerHTML = '<p class="empty-list" style="grid-column: 1/-1;">Henüz personel eklemediniz.</p>'; return; }
    list.innerHTML = businessPersonnel.map((person, idx) => {
        const srvCount = person.services ? person.services.length : 0;
        return `
        <div class="personnel-card">
            <button class="delete-personnel-btn" onclick="removePersonnel(${idx})" title="Personeli Sil">✕</button>
            <div class="personnel-header">
                <div class="personnel-avatar">${person.name.charAt(0).toUpperCase()}</div>
                <div class="personnel-info"><h5>${person.name}</h5><span>${srvCount > 0 ? srvCount + ' Hizmet Atandı' : 'Hizmet Atanmadı'}</span></div>
            </div>
            <p style="font-size:0.75rem; color:#64748b; margin-bottom:10px;">Giriş PIN: <b>${person.pin}</b></p>
            <div class="personnel-actions">
                <button class="personnel-action-btn" onclick="openPersonnelServicesModal(${idx})"><span>🏷️ Hizmetlerini Seç</span> <span style="color:#0ea5e9;">➔</span></button>
                <button class="personnel-action-btn" onclick="openPersonnelScheduleModal(${idx})"><span>⏱️ Çalışma Saatleri</span> <span style="color:#0ea5e9;">➔</span></button>
            </div>
        </div>
        `;
    }).join('');
}

const addPersonnelBtn = document.getElementById('add-personnel-btn');
if (addPersonnelBtn) {
    addPersonnelBtn.addEventListener('click', () => {
        const nameInput = document.getElementById('new-personnel-name'); const pinInput = document.getElementById('new-personnel-pin');
        if (nameInput.value.trim() !== '' && pinInput.value.trim().length === 4) {
            const defaultSched = JSON.parse(JSON.stringify(businessSchedule));
            businessPersonnel.push({ id: 'p_' + Date.now(), name: nameInput.value.trim(), pin: pinInput.value.trim(), services: [], schedule: defaultSched });
            nameInput.value = ''; pinInput.value = ''; renderPersonnelUI();
        } else { Toast.fire({ icon: 'warning', title: 'Personel adı ve 4 Haneli PIN girmelisiniz!' }); }
    });
}
window.removePersonnel = (idx) => {
    Swal.fire({ title: 'Emin misiniz?', text: "Bu personeli silmek üzeresiniz.", icon: 'warning', showCancelButton: true, confirmButtonText: 'Evet, Sil', cancelButtonText: 'İptal', confirmButtonColor: '#ef4444' }).then((res) => {
        if (res.isConfirmed) { businessPersonnel.splice(idx, 1); renderPersonnelUI(); }
    });
};

window.openPersonnelServicesModal = async (idx) => {
    const person = businessPersonnel[idx];
    if (businessServices.length === 0) { return Toast.fire({ icon: 'info', title: 'Önce Yukarıdan Hizmet Ekleyin!' }); }

    const checkboxesHTML = businessServices.map((srv, sIdx) => {
        const isChecked = person.services && person.services.includes(srv.name) ? 'checked' : '';
        return `
            <label class="swal-service-item" style="display:flex; align-items:center; gap:10px; background:#f1f5f9; padding:10px; border-radius:8px; border:1px solid #cbd5e1; margin-bottom:5px; cursor:pointer;">
                <input type="checkbox" id="psrv_${sIdx}" value="${srv.name}" ${isChecked} style="width:18px; height:18px; accent-color:#0ea5e9;"> 
                <span>${srv.name} <strong style="color:#16a34a; font-size:0.8rem; margin-left:5px;">(${srv.price} ₺)</strong></span>
            </label>
        `;
    }).join('');

    const { value: formValues } = await Swal.fire({
        title: `${person.name} Hizmetleri`,
        html: `<p style="font-size:0.9rem; color:#64748b; margin-bottom:10px; text-align:left;">Bu personelin yapabildiği işlemleri işaretleyin.</p><div style="max-height:300px; overflow-y:auto;">${checkboxesHTML}</div>`,
        focusConfirm: false, showCancelButton: true, confirmButtonText: 'Kaydet', cancelButtonText: 'İptal',
        preConfirm: () => {
            let selected = [];
            businessServices.forEach((srv, sIdx) => { if (document.getElementById(`psrv_${sIdx}`).checked) { selected.push(srv.name); } });
            return selected;
        }
    });

    if (formValues) { person.services = formValues; renderPersonnelUI(); Toast.fire({ icon: 'success', title: 'Hizmetler atandı!' }); }
};

window.addPersonnelBreakInline = (dayId) => {
    const container = document.getElementById(`pbreaks_container_${dayId}`);
    container.insertAdjacentHTML('beforeend', `<div class="inline-break-form" style="display:inline-flex; gap:5px; align-items:center; margin-top:5px; background:#fff7ed; padding:4px 8px; border-radius:6px; border:1px solid #fed7aa;"><input type="time" class="p-br-start" value="12:00" style="background:transparent; border:none; color:#ea580c; font-weight:bold; width:auto; outline:none;"><span style="color:#ea580c;">-</span><input type="time" class="p-br-end" value="13:00" style="background:transparent; border:none; color:#ea580c; font-weight:bold; width:auto; outline:none;"><button type="button" onclick="this.parentElement.remove()" style="background:transparent; border:none; color:#ef4444; font-weight:bold; cursor:pointer; margin-left:5px;">✕</button></div>`);
};

window.openPersonnelScheduleModal = async (idx) => {
    const person = businessPersonnel[idx];
    let scheduleHTML = daysOfWeek.map(day => {
        const dSet = person.schedule[day.id];
        const existingBreaksHTML = (dSet.breaks || []).map(br => `<div class="inline-break-form" style="display:inline-flex; gap:5px; align-items:center; margin-top:5px; background:#e0f2fe; padding:4px 8px; border-radius:6px; border:1px solid #bae6fd;"><input type="time" class="p-br-start" value="${br.start}" style="background:transparent; border:none; color:#0284c7; font-weight:bold; width:auto; outline:none;"><span style="color:#0284c7;">-</span><input type="time" class="p-br-end" value="${br.end}" style="background:transparent; border:none; color:#0284c7; font-weight:bold; width:auto; outline:none;"><button type="button" onclick="this.parentElement.remove()" style="background:transparent; border:none; color:#ef4444; font-weight:bold; cursor:pointer; margin-left:5px;">✕</button></div>`).join('');
        return `
        <div style="background:#f8fafc; padding:12px; margin-bottom:12px; border-radius:8px; border:1px solid #cbd5e1; text-align:left;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                <div style="width:100px; font-weight:700; color:#1e293b;">${day.name}</div>
                <div style="display:flex; gap:10px; align-items:center;">
                    <input type="checkbox" id="pact_${day.id}" ${dSet.active ? 'checked' : ''} style="width:18px; height:18px; accent-color:#0ea5e9;">
                    <input type="time" id="pstart_${day.id}" value="${dSet.start}" style="padding:6px; border:1px solid #cbd5e1; border-radius:6px; outline:none; background:#fff;">
                    <span style="color:#64748b; font-weight:600;">-</span>
                    <input type="time" id="pend_${day.id}" value="${dSet.end}" style="padding:6px; border:1px solid #cbd5e1; border-radius:6px; outline:none; background:#fff;">
                    <button type="button" onclick="addPersonnelBreakInline('${day.id}')" style="background:#fff; border:1px solid #0ea5e9; color:#0ea5e9; padding:6px 10px; border-radius:6px; cursor:pointer; font-size:0.85rem; font-weight:600; transition:0.2s;">+ Mola</button>
                </div>
            </div>
            <div id="pbreaks_container_${day.id}" style="display:flex; flex-wrap:wrap; gap:8px;">${existingBreaksHTML}</div>
        </div>`;
    }).join('');

    const { value: formValues } = await Swal.fire({
        title: `${person.name} Mesai & Molaları`,
        html: `<div style="max-height:450px; overflow-y:auto; padding-right:5px;">${scheduleHTML}</div>`, width: '650px', showCancelButton: true, confirmButtonText: 'Kaydet', cancelButtonText: 'İptal',
        preConfirm: () => {
            let newSchedule = {}; let hasError = false;
            daysOfWeek.forEach(day => {
                let breaks = [];
                const breakForms = document.getElementById(`pbreaks_container_${day.id}`).querySelectorAll('.inline-break-form');
                breakForms.forEach(bf => {
                    const s = bf.querySelector('.p-br-start').value; const e = bf.querySelector('.p-br-end').value;
                    if (s >= e) hasError = true; breaks.push({ start: s, end: e });
                });
                breaks.sort((a, b) => a.start.localeCompare(b.start));
                newSchedule[day.id] = { active: document.getElementById(`pact_${day.id}`).checked, start: document.getElementById(`pstart_${day.id}`).value, end: document.getElementById(`pend_${day.id}`).value, breaks: breaks };
            });
            if (hasError) { Swal.showValidationMessage('Mola bitiş saati başlangıçtan küçük olamaz!'); return false; } return newSchedule;
        }
    });

    if (formValues) { person.schedule = formValues; Toast.fire({ icon: 'success', title: 'Mesai saatleri güncellendi!' }); renderPersonnelUI(); }
};

function renderHolidaysUI() { const list = document.getElementById('holidays-list'); if (!list) return; list.innerHTML = businessHolidays.map((dateStr, idx) => `<div class="break-badge" style="background:#fff7ed; border-color:#fed7aa; color:#f59e0b;">🏖️ ${new Date(dateStr).toLocaleDateString('tr-TR')} <span class="remove-break" onclick="removeHoliday(${idx})">✕</span></div>`).join(''); }
const addHolidayBtn = document.getElementById('add-holiday-btn'); if (addHolidayBtn) { addHolidayBtn.addEventListener('click', () => { const dateInput = document.getElementById('new-holiday-date'); if (dateInput.value && !businessHolidays.includes(dateInput.value)) { businessHolidays.push(dateInput.value); dateInput.value = ''; renderHolidaysUI(); } }); }
window.removeHoliday = (idx) => { businessHolidays.splice(idx, 1); renderHolidaysUI(); };
window.toggleDay = (dayId) => { businessSchedule[dayId].active = !businessSchedule[dayId].active; renderScheduleUI(); }; window.updateTime = (dayId, type, value) => { businessSchedule[dayId][type] = value; }; window.removeBreak = (dayId, index) => { businessSchedule[dayId].breaks.splice(index, 1); renderScheduleUI(); };

window.openBreakModal = async (dayId, dayName) => {
    const { value: formValues } = await Swal.fire({
        title: `${dayName} için Mola`,
        html: `<div style="display:flex; justify-content:center; gap:10px; align-items:center;"><input id="br-start" type="time" class="modern-input" style="width:120px; margin:0;" value="12:00"><span style="color:#1e293b; font-weight:bold;">-</span><input id="br-end" type="time" class="modern-input" style="width:120px; margin:0;" value="13:00"></div>`, focusConfirm: false, showCancelButton: true, confirmButtonText: 'Ekle', cancelButtonText: 'İptal',
        preConfirm: () => { const start = document.getElementById('br-start').value; const end = document.getElementById('br-end').value; if (start >= end) { Swal.showValidationMessage('Bitiş saati büyük olmalıdır!'); return false; } return { start, end }; }
    });
    if (formValues) { businessSchedule[dayId].breaks.push(formValues); businessSchedule[dayId].breaks.sort((a, b) => a.start.localeCompare(b.start)); renderScheduleUI(); }
};

const saveSettingsBtn = document.getElementById('save-settings-btn');
if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener('click', async () => {
        const duration = document.getElementById('appointment-duration').value;
        const originalText = saveSettingsBtn.textContent; saveSettingsBtn.textContent = "Kaydediliyor..."; saveSettingsBtn.disabled = true;

        try {
            const user = auth.currentUser;
            if (user) {
                const uidToSave = isPersonnelMode ? targetBusinessUid : user.uid;
                const docRef = doc(db, "businesses", uidToSave);
                const settingsData = { appointmentDuration: parseInt(duration), schedule: businessSchedule, services: businessServices, personnel: businessPersonnel, closedDates: businessHolidays };
                await setDoc(docRef, { settings: settingsData }, { merge: true });
                currentBusinessSettings = settingsData; generateTimeSlots(); Toast.fire({ icon: 'success', title: 'Tüm ayarlar başarıyla kaydedildi!' });
            }
        } catch (error) { Toast.fire({ icon: 'error', title: 'Hata oluştu!' }); } finally { saveSettingsBtn.textContent = originalText; saveSettingsBtn.disabled = false; }
    });
}

// --- 6. AKILLI TAKVİM VE RANDEVU ALGORİTMASI ---
const calendarDateInput = document.getElementById('calendar-date'); const prevDayBtn = document.getElementById('prev-day-btn'); const nextDayBtn = document.getElementById('next-day-btn'); const slotsContainer = document.getElementById('slots-container'); const calendarStatus = document.getElementById('calendar-status-text'); const formattedDateDisplay = document.getElementById('formatted-date-display'); const listTitleDate = document.getElementById('selected-date-list-title');
let currentBusinessSettings = null; let currentDayBookings = [];

if (calendarDateInput) {
    const today = new Date(); const localDate = new Date(today.getTime() - (today.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
    calendarDateInput.value = localDate; updateDateDisplay(localDate);
    prevDayBtn.addEventListener('click', () => changeDate(-1)); nextDayBtn.addEventListener('click', () => changeDate(1));
    calendarDateInput.addEventListener('change', (e) => { updateDateDisplay(e.target.value); generateTimeSlots(); });
}

function updateDateDisplay(dateStr) {
    if (!dateStr) return; const [yyyy, mm, dd] = dateStr.split('-'); const dateObj = new Date(yyyy, mm - 1, dd); const options = { day: 'numeric', month: 'long', weekday: 'long' }; const formattedDate = dateObj.toLocaleDateString('tr-TR', options);
    if (formattedDateDisplay) { formattedDateDisplay.textContent = formattedDate; } if (listTitleDate) { listTitleDate.textContent = formattedDate; }
}
function changeDate(days) { const currentDate = new Date(calendarDateInput.value); currentDate.setDate(currentDate.getDate() + days); const newDateStr = currentDate.toISOString().split('T')[0]; calendarDateInput.value = newDateStr; updateDateDisplay(newDateStr); generateTimeSlots(); }
function timeToMinutes(timeStr) { const [hours, minutes] = timeStr.split(':').map(Number); return (hours * 60) + minutes; }
function minutesToTime(minutesTotal) { const hours = Math.floor(minutesTotal / 60).toString().padStart(2, '0'); const minutes = (minutesTotal % 60).toString().padStart(2, '0'); return `${hours}:${minutes}`; }
function checkBreakOverlap(slotStartMin, duration, breaks) { if (!breaks || breaks.length === 0) return false; const slotEndMin = slotStartMin + duration; for (let br of breaks) { if (slotStartMin < timeToMinutes(br.end) && slotEndMin > timeToMinutes(br.start)) { return true; } } return false; }

async function fetchBusinessSettings(uid) {
    try {
        const docRef = doc(db, "businesses", uid); const docSnap = await getDoc(docRef);
        if (docSnap.exists() && docSnap.data().settings) {
            currentBusinessSettings = docSnap.data().settings;
            if (currentBusinessSettings.schedule) { businessSchedule = currentBusinessSettings.schedule; }
            if (currentBusinessSettings.services) { businessServices = currentBusinessSettings.services; }
            if (currentBusinessSettings.personnel) { businessPersonnel = currentBusinessSettings.personnel; }
            if (currentBusinessSettings.closedDates) { businessHolidays = currentBusinessSettings.closedDates; }

            const durationInput = document.getElementById('appointment-duration');
            if (currentBusinessSettings.appointmentDuration && durationInput) { durationInput.value = currentBusinessSettings.appointmentDuration; }

            if (!isPersonnelMode) { renderScheduleUI(); }

            const filterContainer = document.getElementById('personnel-filter-container'); const filterSelect = document.getElementById('appointment-personnel-filter');
            if (filterContainer && filterSelect) {
                if (isPersonnelMode) {
                    filterContainer.style.display = 'block'; filterSelect.innerHTML = `<option value="${loggedInPersonnelName}">${loggedInPersonnelName}</option>`; filterSelect.disabled = true; filterSelect.style.background = '#e2e8f0';
                } else if (businessPersonnel && businessPersonnel.length > 0) {
                    filterContainer.style.display = 'block'; let options = '<option value="all">Genel Görünüm (Tüm İşletme)</option>';
                    businessPersonnel.forEach(p => { options += `<option value="${p.name}">${p.name}</option>`; });
                    filterSelect.innerHTML = options; filterSelect.disabled = false; filterSelect.style.background = '#ffffff';
                    filterSelect.addEventListener('change', () => { generateTimeSlots(); });
                } else { filterContainer.style.display = 'none'; }
            }
        }
    } catch (error) { console.error("Ayarlar çekilemedi:", error); }
    generateTimeSlots();
}

async function generateTimeSlots() {
    if (!slotsContainer) return;
    const selectedDateStr = calendarDateInput.value;
    const filterSelect = document.getElementById('appointment-personnel-filter'); const selectedPersonnelFilter = filterSelect ? filterSelect.value : (isPersonnelMode ? loggedInPersonnelName : 'all');

    fetchAndRenderAppointmentsList(selectedDateStr, selectedPersonnelFilter);

    if (!currentBusinessSettings || !currentBusinessSettings.schedule) { slotsContainer.innerHTML = ''; if (calendarStatus) calendarStatus.innerHTML = `<span style="color:#f59e0b;">⚠️ Lütfen önce 'Ayarlar' sekmesinden çalışma saatlerinizi kaydedin.</span>`; return; }
    if (currentBusinessSettings.closedDates && currentBusinessSettings.closedDates.includes(selectedDateStr)) { slotsContainer.innerHTML = ''; if (calendarStatus) calendarStatus.innerHTML = `<span style="color:#ef4444;">🏖️ İşletme bu tarihte kapalıdır (Tatil).</span>`; return; }

    try {
        slotsContainer.innerHTML = ''; if (calendarStatus) calendarStatus.innerHTML = `<span style="color:#0ea5e9;">Randevular listeleniyor...</span>`;

        const [yyyy, mm, dd] = selectedDateStr.split('-'); const dateObj = new Date(yyyy, mm - 1, dd); const dayMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']; const selectedDayId = dayMap[dateObj.getDay()];
        const gridStep = currentBusinessSettings.appointmentDuration || 30;

        let daySettings; let activeCapacity;

        if (selectedPersonnelFilter !== 'all') {
            const personObj = businessPersonnel.find(p => p.name === selectedPersonnelFilter);
            daySettings = personObj ? personObj.schedule[selectedDayId] : currentBusinessSettings.schedule[selectedDayId];
            activeCapacity = 1;
        } else {
            daySettings = currentBusinessSettings.schedule[selectedDayId];
            activeCapacity = businessPersonnel.length > 0 ? businessPersonnel.filter(p => p.schedule[selectedDayId].active).length : 1;
            if (activeCapacity === 0) activeCapacity = 1;
        }

        if (!daySettings || !daySettings.active) { if (calendarStatus) { calendarStatus.innerHTML = `<span style="color:#ef4444;">${selectedPersonnelFilter !== 'all' ? selectedPersonnelFilter + ' bugün çalışmıyor.' : 'İşletme bu günde kapalıdır.'}</span>`; } return; }

        const uidToFetch = isPersonnelMode ? targetBusinessUid : auth.currentUser.uid;
        const q = query(collection(db, "businesses", uidToFetch, "appointments"), where("date", "==", selectedDateStr), where("status", "in", ["confirmed", "pending"]));
        const querySnapshot = await getDocs(q); currentDayBookings = [];

        querySnapshot.forEach(doc => {
            const data = doc.data();
            if (!data.date) return;
            const startMin = timeToMinutes(data.time); const endMin = data.endTime ? timeToMinutes(data.endTime) : startMin + gridStep;
            currentDayBookings.push({ startMin, endMin, serviceName: data.serviceName, clientName: data.clientName, personnelName: data.personnelName });
        });

        if (calendarStatus) { calendarStatus.textContent = selectedPersonnelFilter !== 'all' ? `${selectedPersonnelFilter} için boş saatler.` : "Yeni randevu oluşturmak için boş saatlere tıklayın."; }

        let currentTimeMinutes = timeToMinutes(daySettings.start); const endTimeMinutes = timeToMinutes(daySettings.end);

        while (currentTimeMinutes + gridStep <= endTimeMinutes) {
            const slotStartStr = minutesToTime(currentTimeMinutes); const isBreak = checkBreakOverlap(currentTimeMinutes, gridStep, daySettings.breaks);

            if (!isBreak) {
                let overlapCount = 0;
                for (let b of currentDayBookings) {
                    if (currentTimeMinutes < b.endMin && (currentTimeMinutes + gridStep) > b.startMin) {
                        if (selectedPersonnelFilter !== 'all') { if (b.personnelName === selectedPersonnelFilter) overlapCount++; } else { overlapCount++; }
                    }
                }

                if (overlapCount >= activeCapacity) {
                    slotsContainer.insertAdjacentHTML('beforeend', `<div class="time-slot disabled"><span class="slot-time">${slotStartStr}</span><span class="slot-status" style="color:#ef4444; font-size:0.75rem;">Dolu</span></div>`);
                } else {
                    let statusHtml = (selectedPersonnelFilter === 'all' && overlapCount > 0) ? `<span class="slot-status" style="color:#f59e0b;">${overlapCount}/${activeCapacity} Dolu</span>` : `<span class="slot-status">Müsait</span>`;
                    slotsContainer.insertAdjacentHTML('beforeend', `<div class="time-slot" onclick="openNewAppointmentModal('${selectedDateStr}', '${slotStartStr}')"><span class="slot-time">${slotStartStr}</span>${statusHtml}</div>`);
                }
            }
            currentTimeMinutes += gridStep;
        }
    } catch (err) { console.error("Slot oluşturulurken hata:", err); }
}

async function fetchAndRenderAppointmentsList(selectedDateStr, filterPersonnel = 'all') {
    const pendingList = document.getElementById('pending-list'); const confirmedList = document.getElementById('confirmed-list');
    if (!pendingList || !confirmedList) return;
    pendingList.innerHTML = '<p class="empty-list" style="color:#64748b;">Yükleniyor...</p>'; confirmedList.innerHTML = '<p class="empty-list" style="color:#64748b;">Yükleniyor...</p>';

    try {
        const uidToFetch = isPersonnelMode ? targetBusinessUid : auth.currentUser.uid;
        const appRef = collection(db, "businesses", uidToFetch, "appointments");
        const snapPending = await getDocs(query(appRef, where("status", "==", "pending"))); const snapConfirmed = await getDocs(query(appRef, where("date", "==", selectedDateStr), where("status", "==", "confirmed")));

        pendingList.innerHTML = ''; let hasPending = false;
        snapPending.forEach(docSnap => {
            const data = docSnap.data(); if (!data.date) return; if (filterPersonnel !== 'all' && data.personnelName !== filterPersonnel) return;
            hasPending = true; const srvName = data.serviceName ? `<span style="font-size:0.75rem; color:#f59e0b;">🏷️ ${data.serviceName}</span>` : ''; const personName = data.personnelName ? `<span style="font-size:0.75rem; color:#0ea5e9; margin-left:5px;">👤 ${data.personnelName}</span>` : '';
            pendingList.insertAdjacentHTML('beforeend', `<div class="app-item"><div class="app-info"><span class="app-time">${data.date} | ${data.time}</span><span class="app-name">Müşteri: ${data.clientName || 'İsimsiz'}</span><div>${srvName}${personName}</div><span class="app-phone">📞 ${data.clientPhone || 'Numara Yok'}</span></div><div class="app-actions"><button class="action-btn btn-approve" onclick="updateAppointmentStatus('${docSnap.id}', 'confirmed')" title="Onayla">✔</button><button class="action-btn btn-cancel" onclick="updateAppointmentStatus('${docSnap.id}', 'cancelled')" title="İptal Et">✖</button></div></div>`);
        });
        if (!hasPending) pendingList.innerHTML = '<p class="empty-list" style="color:#64748b;">Onay bekleyen randevu yok.</p>';

        confirmedList.innerHTML = ''; let hasConfirmed = false;
        snapConfirmed.forEach(docSnap => {
            const data = docSnap.data(); if (!data.date) return; if (filterPersonnel !== 'all' && data.personnelName !== filterPersonnel) return;
            hasConfirmed = true; const noteHtml = data.note ? `<span class="app-note">Not: ${data.note}</span>` : ''; const srvName = data.serviceName ? `<span style="font-size:0.75rem; color:#f59e0b;">🏷️ ${data.serviceName}</span>` : ''; const personName = data.personnelName ? `<span style="font-size:0.75rem; color:#0ea5e9; margin-left:5px;">👤 ${data.personnelName}</span>` : ''; const cleanNum = data.clientPhone ? cleanPhone(data.clientPhone) : '';
            confirmedList.insertAdjacentHTML('beforeend', `<div class="app-item" style="flex-direction:column; align-items:stretch;"><div style="display:flex; justify-content:space-between; align-items:start;"><div class="app-info"><span class="app-time">⏰ ${data.time} - ${data.endTime || ''}</span><span class="app-name">Müşteri: ${data.clientName || 'İsimsiz'}</span><div>${srvName}${personName}</div>${noteHtml}</div><div class="app-actions"><button class="action-btn btn-cancel" onclick="updateAppointmentStatus('${docSnap.id}', 'cancelled')" title="İptal Et">✖</button></div></div><div class="contact-actions" style="margin-top:10px;"><a href="tel:+${cleanNum}" class="contact-btn btn-call" title="Ara">📞 Ara</a><a href="https://wa.me/${cleanNum}" target="_blank" class="contact-btn btn-wa" title="WhatsApp">💬 WhatsApp</a></div></div>`);
        });
        if (!hasConfirmed) confirmedList.innerHTML = '<p class="empty-list" style="color:#64748b;">Bu tarihte onaylı randevu yok.</p>';

    } catch (error) { console.error("Listeler çekilemedi:", error); }
}

window.updateAppointmentStatus = async (appId, newStatus) => {
    try {
        const uidToFetch = isPersonnelMode ? targetBusinessUid : auth.currentUser.uid;
        const appRef = doc(db, "businesses", uidToFetch, "appointments", appId);
        const appSnap = await getDoc(appRef);
        const appData = appSnap.data();

        await updateDoc(appRef, { status: newStatus });

        const actionTitle = newStatus === 'confirmed' ? 'Onaylandı! ✅' : 'İptal Edildi! ❌';
        const actionVerb = newStatus === 'confirmed' ? 'onaylanmıştır. Bekliyoruz!' : 'maalesef iptal edilmiştir. İletişime geçebilirsiniz.';
        const swalIcon = newStatus === 'confirmed' ? 'success' : 'warning';

        Swal.fire({
            title: actionTitle,
            text: `Müşteriye WhatsApp üzerinden randevunun ${newStatus === 'confirmed' ? 'onaylandığını' : 'iptal edildiğini'} bildirmek ister misiniz?`,
            icon: swalIcon,
            showCancelButton: true,
            confirmButtonText: '💬 WhatsApp ile Bildir',
            cancelButtonText: 'Gerek Yok'
        }).then((result) => {
            if (result.isConfirmed && appData.clientPhone) {
                const msg = `Merhaba ${appData.clientName}, ${appData.date} tarihi saat ${appData.time} için randevunuz ${actionVerb}`;
                const waUrl = `https://wa.me/${cleanPhone(appData.clientPhone)}?text=${encodeURIComponent(msg)}`;
                window.open(waUrl, '_blank');
            }
        });

        generateTimeSlots();
        if (!isPersonnelMode) { loadDashboardAndCRM(); }
    } catch (e) { Toast.fire({ icon: 'error', title: 'İşlem başarısız!' }); }
}

window.openNewAppointmentModal = async (date, time) => {
    const displayDate = document.getElementById('formatted-date-display').textContent; const gridStep = currentBusinessSettings.appointmentDuration || 30; const startTimeMin = timeToMinutes(time);
    const currentFilter = document.getElementById('appointment-personnel-filter')?.value;

    let servicesOptionsHTML = '';
    if (businessServices && businessServices.length > 0) {
        let allowedServices = businessServices;
        if (isPersonnelMode) { const pObj = businessPersonnel.find(p => p.name === loggedInPersonnelName); if (pObj && pObj.services) { allowedServices = businessServices.filter(s => pObj.services.includes(s.name)); } }
        const options = allowedServices.map(s => `<option value="${s.name}" data-duration="${s.duration}">${s.name} (${s.duration} Dk)</option>`).join('');
        servicesOptionsHTML = `<select id="client-service" class="modern-select" style="margin-top:15px; width:100%;"><option value="">Hizmet Seçiniz (Varsayılan: ${gridStep} Dk)</option>${options}</select>`;
    }

    let personnelOptionsHTML = '';
    if (businessPersonnel && businessPersonnel.length > 0) {
        if (isPersonnelMode) {
            personnelOptionsHTML = `<select id="client-personnel" class="modern-select" style="margin-top:15px; width:100%; background:#e2e8f0;" disabled><option value="${loggedInPersonnelName}">${loggedInPersonnelName}</option></select>`;
        } else {
            const [yyyy, mm, dd] = date.split('-'); const dateObj = new Date(yyyy, mm - 1, dd); const dayMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']; const selectedDayId = dayMap[dateObj.getDay()];
            let pOptions = '';
            businessPersonnel.forEach(p => {
                let isBusy = false; const pDay = p.schedule[selectedDayId];
                if (!pDay || !pDay.active || startTimeMin < timeToMinutes(pDay.start) || startTimeMin >= timeToMinutes(pDay.end)) { isBusy = true; } else {
                    for (let b of currentDayBookings) { if (b.personnelName === p.name && (startTimeMin < b.endMin && (startTimeMin + gridStep) > b.startMin)) { isBusy = true; break; } }
                }
                let isSelected = (currentFilter === p.name && !isBusy) ? 'selected' : '';
                if (isBusy) { pOptions += `<option value="${p.name}" disabled>❌ ${p.name} (Uygun Değil)</option>`; } else { pOptions += `<option value="${p.name}" ${isSelected}>✅ ${p.name}</option>`; }
            });
            personnelOptionsHTML = `<select id="client-personnel" class="modern-select" style="margin-top:15px; width:100%;"><option value="">Personel Seçiniz (Fark Etmez)</option>${pOptions}</select>`;
        }
    }

    const { value: formValues } = await Swal.fire({
        title: 'Yeni Randevu Oluştur',
        html: `<div style="color: #0ea5e9; font-weight: bold; margin-bottom: 20px; padding:10px; background:rgba(14,165,233,0.1); border-radius:8px;">🗓️ ${displayDate} - ⏰ ${time}</div><input id="client-name" class="swal-custom-input" placeholder="Müşteri Adı Soyadı" required><div class="swal-phone-group" style="margin-bottom:0;"><span class="swal-phone-prefix">+90</span><input id="client-phone" class="swal-phone-input" placeholder="5XX XXX XX XX" type="tel" maxlength="10"></div>${servicesOptionsHTML}${personnelOptionsHTML}<textarea id="client-note" class="swal-custom-input" placeholder="Randevu Notu (İsteğe Bağlı)" rows="2" style="margin-top:15px; resize:none;"></textarea>`,
        focusConfirm: false, showCancelButton: true, confirmButtonText: 'Kaydet', cancelButtonText: 'İptal',
        preConfirm: () => {
            const name = document.getElementById('client-name').value; const phoneRaw = document.getElementById('client-phone').value; const note = document.getElementById('client-note').value;
            const serviceEl = document.getElementById('client-service'); let serviceName = ""; let serviceDuration = gridStep;
            if (serviceEl && serviceEl.selectedIndex > 0) { serviceName = serviceEl.options[serviceEl.selectedIndex].value; serviceDuration = parseInt(serviceEl.options[serviceEl.selectedIndex].getAttribute('data-duration')); }

            const personEl = document.getElementById('client-personnel'); let personnelName = "";
            if (personEl && personEl.selectedIndex > 0) { personnelName = personEl.options[personEl.selectedIndex].value; }
            if (isPersonnelMode) personnelName = loggedInPersonnelName;

            if (!name) { Swal.showValidationMessage('Müşteri adı zorunludur!'); return false; }
            if (phoneRaw.length < 10) { Swal.showValidationMessage('Geçerli telefon girin!'); return false; }
            return { name, phone: "+90" + phoneRaw.replace(/\s+/g, ''), note, serviceName, duration: serviceDuration, personnelName };
        }
    });

    if (formValues) {
        let finalPersonnelName = formValues.personnelName;

        if (!finalPersonnelName && businessPersonnel && businessPersonnel.length > 0) {
            const [yyyy, mm, dd] = date.split('-');
            const dateObj = new Date(yyyy, mm - 1, dd);
            const dayMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
            const selectedDayId = dayMap[dateObj.getDay()];

            const startMin = timeToMinutes(time);
            const endMin = startMin + formValues.duration;

            let availableForSlot = [];
            businessPersonnel.forEach(p => {
                if (p.services && p.services.length > 0 && !p.services.includes(formValues.serviceName)) return;

                const pDay = p.schedule[selectedDayId];
                if (!pDay || !pDay.active || startMin < timeToMinutes(pDay.start) || endMin > timeToMinutes(pDay.end)) return;

                if (checkBreakOverlap(startMin, formValues.duration, pDay.breaks)) return;

                let hasConflict = false;
                for (let b of currentDayBookings) {
                    if (b.personnelName === p.name && (startMin < b.endMin && endMin > b.startMin)) {
                        hasConflict = true; break;
                    }
                }

                if (!hasConflict) availableForSlot.push(p.name);
            });

            if (availableForSlot.length > 0) {
                finalPersonnelName = availableForSlot[Math.floor(Math.random() * availableForSlot.length)];
            }
        }

        try {
            Swal.fire({ title: 'Kaydediliyor...', didOpen: () => { Swal.showLoading(); } });
            const startTimeMin = timeToMinutes(time); const endTimeMin = startTimeMin + formValues.duration; const endTimeStr = minutesToTime(endTimeMin);
            const uidToFetch = isPersonnelMode ? targetBusinessUid : auth.currentUser.uid;

            await addDoc(collection(db, "businesses", uidToFetch, "appointments"), { date: date, time: time, endTime: endTimeStr, clientName: formValues.name, clientPhone: formValues.phone, note: formValues.note, serviceName: formValues.serviceName, personnelName: finalPersonnelName, duration: formValues.duration, status: 'confirmed', createdAt: new Date() });

            Toast.fire({ icon: 'success', title: 'Randevu başarıyla eklendi!' }); generateTimeSlots(); if (!isPersonnelMode) { loadDashboardAndCRM(); }
        } catch (error) { Toast.fire({ icon: 'error', title: 'Hata oluştu!' }); }
    }
};

// --- 8. CRM VE GRAFİKLER ---
const statToday = document.getElementById('stat-today'); const statPending = document.getElementById('stat-pending'); const statClients = document.getElementById('stat-clients'); const clientsContainer = document.getElementById('clients-container'); const clientSearchInput = document.getElementById('client-search-input');
let overviewChart = null; let allClientsData = [];

const getLocalYMD = (d) => { const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const day = String(d.getDate()).padStart(2, '0'); return `${y}-${m}-${day}`; };

async function loadDashboardAndCRM() {
    try {
        const uidToFetch = isPersonnelMode ? targetBusinessUid : auth.currentUser.uid;
        const snapshot = await getDocs(collection(db, "businesses", uidToFetch, "appointments"));

        let todayCount = 0; let pendingCount = 0; let monthlyCount = 0; const uniqueClients = new Map();
        const today = new Date(); const localTodayStr = getLocalYMD(today); const currentMonth = localTodayStr.substring(0, 7);
        const dateArray = []; const chartCounts = {}; const upcomingAppointments = [];

        for (let i = -15; i <= 14; i++) { const d = new Date(); d.setDate(d.getDate() + i); const dateStr = getLocalYMD(d); dateArray.push(dateStr); chartCounts[dateStr] = 0; }
        const chartTitle = document.querySelector('.chart-card h4'); if (chartTitle) { chartTitle.innerHTML = '📊 Aylık Randevu Yoğunluğu (Geçmiş & Gelecek)'; }

        snapshot.forEach(doc => {
            const data = doc.data(); if (!data.date) return;
            if (data.date === localTodayStr && data.status === 'confirmed') todayCount++;
            if (data.status === 'pending') pendingCount++;
            if (data.date.startsWith(currentMonth) && data.status === 'confirmed') monthlyCount++;
            if (data.status === 'confirmed' && chartCounts[data.date] !== undefined) { chartCounts[data.date]++; }
            if (data.status === 'confirmed' && data.date >= localTodayStr) { upcomingAppointments.push(data); }
            if (data.clientPhone) {
                if (!uniqueClients.has(data.clientPhone)) { uniqueClients.set(data.clientPhone, { name: data.clientName, phone: data.clientPhone, appointmentCount: 0, history: [] }); }
                const clientObj = uniqueClients.get(data.clientPhone); clientObj.appointmentCount += 1;
                clientObj.history.push({ date: data.date, time: data.time, status: data.status, note: data.note, serviceName: data.serviceName, personnelName: data.personnelName });
            }
        });

        if (statToday) statToday.textContent = todayCount; if (statPending) statPending.textContent = pendingCount; if (statClients) statClients.textContent = uniqueClients.size;
        const statMonthly = document.getElementById('stat-monthly'); if (statMonthly) statMonthly.textContent = monthlyCount;

        const upcomingListContainer = document.getElementById('upcoming-list');
        if (upcomingListContainer) {
            upcomingAppointments.sort((a, b) => new Date(`${a.date}T${a.time}`) - new Date(`${b.date}T${b.time}`)); const topUpcoming = upcomingAppointments.slice(0, 10);
            if (topUpcoming.length === 0) { upcomingListContainer.innerHTML = '<p class="empty-list" style="color:#64748b;">Yaklaşan randevu yok.</p>'; } else {
                upcomingListContainer.innerHTML = topUpcoming.map(app => `<div class="upcoming-item"><span class="upcoming-date">📅 ${app.date} | ⏰ ${app.time}</span><span class="upcoming-name">👤 ${app.clientName || 'İsimsiz'}</span><span class="upcoming-service">🏷️ ${app.serviceName || 'Genel'} ${app.personnelName ? `(👤 ${app.personnelName})` : ''}</span></div>`).join('');
            }
        }

        allClientsData = Array.from(uniqueClients.values()).sort((a, b) => b.appointmentCount - a.appointmentCount); renderClientsList(allClientsData);

        try {
            const ctx = document.getElementById('overviewChart');
            if (ctx && typeof Chart !== 'undefined') {
                if (overviewChart) overviewChart.destroy();
                const displayLabels = dateArray.map(dateStr => { const parts = dateStr.split('-'); const monthIndex = parseInt(parts[1], 10) - 1; const months = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"]; return `${parseInt(parts[2], 10)} ${months[monthIndex]}`; });
                const chartContext = ctx.getContext('2d'); let gradient = chartContext.createLinearGradient(0, 0, 0, 300); gradient.addColorStop(0, 'rgba(14, 165, 233, 0.9)'); gradient.addColorStop(1, 'rgba(14, 165, 233, 0.1)');
                overviewChart = new Chart(ctx, { type: 'bar', data: { labels: displayLabels, datasets: [{ label: 'Onaylı Randevular', data: dateArray.map(d => chartCounts[d]), backgroundColor: gradient, borderRadius: 4, borderSkipped: false, barPercentage: 0.6 }] }, options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { color: '#64748b', stepSize: 1 }, grid: { color: 'rgba(0,0,0,0.05)', drawBorder: false } }, x: { ticks: { color: '#64748b', maxRotation: 0, maxTicksLimit: 10 }, grid: { display: false } } }, plugins: { legend: { display: false }, tooltip: { backgroundColor: '#1e293b', titleColor: '#0ea5e9', bodyColor: '#ffffff', padding: 12, cornerRadius: 8 } } } });
            }
        } catch (chartErr) { console.error("Grafik çizilirken hata:", chartErr); }
    } catch (error) { console.error("Dashboard yüklenirken hata:", error); }
}

function renderClientsList(clientsArray) {
    if (!clientsContainer) return;
    if (!clientsArray || clientsArray.length === 0) { clientsContainer.innerHTML = '<p class="empty-list" style="color: #64748b; text-align: center; padding: 20px;">Henüz kayıtlı müşteri bulunmuyor.</p>'; return; }
    clientsContainer.innerHTML = '';
    clientsArray.forEach(client => {
        try {
            const clientJSON = encodeURIComponent(JSON.stringify(client)); const cleanNum = cleanPhone(client.phone);
            clientsContainer.insertAdjacentHTML('beforeend', `<div class="client-item" style="flex-direction:column; align-items:stretch;"><div style="display:flex; justify-content:space-between; align-items:center;" onclick="showClientDetails('${clientJSON}')"><div class="client-details"><span class="client-name">${client.name || 'İsimsiz'}</span><span class="client-phone">📞 ${client.phone || 'Numara Yok'}</span></div><div class="client-stats">${client.appointmentCount} Randevu</div></div><div class="contact-actions" style="margin-top:12px; border-top:1px solid #e2e8f0; padding-top:10px;"><a href="tel:+${cleanNum}" class="contact-btn btn-call" title="Ara" onclick="event.stopPropagation()">📞 Ara</a><a href="https://wa.me/${cleanNum}" target="_blank" class="contact-btn btn-wa" title="WhatsApp" onclick="event.stopPropagation()">💬 WhatsApp</a></div></div>`);
        } catch (err) { console.error("Müşteri render hatası:", err, client); }
    });
}

if (clientSearchInput) { clientSearchInput.addEventListener('input', (e) => { const searchTerm = e.target.value.toLowerCase(); renderClientsList(allClientsData.filter(c => (c.name || '').toLowerCase().includes(searchTerm) || (c.phone || '').includes(searchTerm))); }); }

window.showClientDetails = (clientJSONStr) => {
    const client = JSON.parse(decodeURIComponent(clientJSONStr)); client.history.sort((a, b) => new Date(b.date) - new Date(a.date));
    const historyHTML = client.history.map(app => {
        let statusBadge = app.status === 'confirmed' ? '<span class="crm-status">Onaylandı</span>' : app.status === 'pending' ? '<span class="crm-status" style="background:#fef3c7; color:#f59e0b;">Bekliyor</span>' : '<span class="crm-status" style="background:#fee2e2; color:#ef4444;">İptal</span>'; const pName = app.personnelName ? ` | 👤 ${app.personnelName}` : '';
        return `<div class="crm-history-item ${app.status === 'cancelled' ? 'cancelled' : ''}">${statusBadge}<div class="crm-date-time">📅 ${app.date} | ⏰ ${app.time}</div>${app.serviceName ? `<span style="font-size:0.8rem; color:#0ea5e9; display:block; margin-top:3px;">🏷️ ${app.serviceName}${pName}</span>` : ''}${app.note ? `<span class="crm-note">"${app.note}"</span>` : ''}</div>`;
    }).join('');
    Swal.fire({ title: `👤 ${client.name || 'İsimsiz'}`, html: `<p style="color:#0ea5e9; font-weight:bold; margin-bottom:20px;">📞 ${client.phone || 'Numara Yok'}</p><h4 style="text-align:left; border-bottom:1px solid #cbd5e1; padding-bottom:5px; margin-bottom:10px;">Geçmiş Randevular</h4><div class="crm-history-list">${historyHTML}</div>`, confirmButtonText: 'Kapat' });
};

// --- YORUM YÜKLEME VE BİLDİRME SİSTEMİ ---
async function loadReviews() {
    const reviewsContainer = document.getElementById('reviews-container'); const statRating = document.getElementById('stat-rating'); const statReviewCount = document.getElementById('stat-review-count');
    if (!reviewsContainer) return;
    try {
        const uidToFetch = isPersonnelMode ? targetBusinessUid : auth.currentUser.uid;
        const q = query(collection(db, "businesses", uidToFetch, "reviews")); const snapshot = await getDocs(q);
        let totalRating = 0; let reviewCount = 0; let reviewsHTML = '';

        if (snapshot.empty) { reviewsContainer.innerHTML = '<p class="empty-list" style="grid-column: 1/-1; color:#64748b;">Henüz hiç yorum almadınız.</p>'; statRating.textContent = '0.0'; statReviewCount.textContent = '0'; return; }

        const reviewsData = []; snapshot.forEach(doc => { reviewsData.push({ id: doc.id, ...doc.data() }); });
        reviewsData.sort((a, b) => new Date(b.date) - new Date(a.date));

        reviewsData.forEach(rev => {
            totalRating += rev.rating; reviewCount++;
            const stars = '★'.repeat(rev.rating) + '☆'.repeat(5 - rev.rating);
            const targetBadge = rev.personnelName ? `<div class="review-target">👤 ${rev.personnelName}</div>` : `<div class="review-target">🏢 Genel İşletme</div>`;
            let actionHtml = ''; if (rev.status === 'reported') { actionHtml = `<div class="review-reported-badge">⚠️ Bildirildi (İnceleniyor)</div>`; } else { actionHtml = `<button class="report-btn" onclick="reportReview('${rev.id}')">⚠️ Yorumu Bildir</button>`; }
            reviewsHTML += `<div class="review-card"><div class="review-header"><div><div class="review-author">${rev.clientName}</div><div class="review-date">${rev.date}</div></div><div class="review-stars">${stars}</div></div>${targetBadge}<div class="review-text">"${rev.comment}"</div>${actionHtml}</div>`;
        });
        const avgRating = (totalRating / reviewCount).toFixed(1); statRating.textContent = avgRating; statReviewCount.textContent = reviewCount; reviewsContainer.innerHTML = reviewsHTML;
    } catch (error) { console.error("Yorumlar çekilirken hata:", error); }
}

window.reportReview = async (reviewId) => {
    const { value: reason } = await Swal.fire({ title: 'Yorumu Bildir', input: 'select', inputOptions: { 'Kaba/Küfürlü Dil': 'Kaba/Küfürlü Dil', 'Sahte/Spam Yorum': 'Sahte/Spam Yorum', 'İşletmeyi Karalama': 'İşletmeyi Karalama', 'Diğer': 'Diğer' }, inputPlaceholder: 'Bildirme Sebebini Seçin', showCancelButton: true, confirmButtonText: 'Bildir', cancelButtonText: 'İptal', inputValidator: (value) => { return new Promise((resolve) => { if (value) { resolve(); } else { resolve('Lütfen bir sebep seçiniz!'); } }); } });
    if (reason) {
        try {
            Swal.fire({ title: 'Bildiriliyor...', didOpen: () => { Swal.showLoading(); } });
            const uidToFetch = isPersonnelMode ? targetBusinessUid : auth.currentUser.uid;
            const reviewRef = doc(db, "businesses", uidToFetch, "reviews", reviewId); const reviewSnap = await getDoc(reviewRef); const reviewData = reviewSnap.exists() ? reviewSnap.data() : {};
            const bizRef = doc(db, "businesses", uidToFetch); const bizSnap = await getDoc(bizRef); const bizName = bizSnap.exists() ? bizSnap.data().businessName : "Bilinmeyen İşletme";
            await updateDoc(reviewRef, { status: 'reported' });
            await addDoc(collection(db, "reported_reviews"), { businessId: uidToFetch, businessName: bizName, reviewId: reviewId, clientName: reviewData.clientName || "İsimsiz", comment: reviewData.comment || "Yorum metni yok", rating: reviewData.rating || 0, personnelName: reviewData.personnelName || "Genel İşletme", reason: reason, reportedAt: new Date().toISOString() });
            Toast.fire({ icon: 'success', title: 'Yorum incelenmek üzere sistem yöneticisine bildirildi.' }); loadReviews();
        } catch (error) { console.error(error); Toast.fire({ icon: 'error', title: 'Bildirim işlemi başarısız oldu!' }); }
    }
};

// ÇIKIŞ YAPMA
document.getElementById('logout-btn').addEventListener('click', () => {
    Swal.fire({ title: 'Çıkış Yapılıyor', text: "Oturumunuzu kapatmak istediğinize emin misiniz?", icon: 'warning', showCancelButton: true, confirmButtonText: 'Çıkış Yap', cancelButtonText: 'İptal' }).then((result) => {
        if (result.isConfirmed) { localStorage.removeItem("activeRole"); signOut(auth).then(() => window.location.replace("index.html")); }
    });
});

// --- BİLDİRİM İZNİ VE SERVICE WORKER KURULUMU (PWA TİTREŞİMLİ BİLDİRİM İÇİN) ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker aktif! PWA ve bildirimler devrede.'))
            .catch(err => console.error('SW Hatası:', err));
    });
}

const notifyBtn = document.getElementById('enable-notifications-btn');
if (notifyBtn) {
    if ("Notification" in window && Notification.permission === "granted") {
        notifyBtn.style.display = 'none';
    }

    notifyBtn.addEventListener('click', () => {
        if (!("Notification" in window)) {
            Toast.fire({ icon: 'error', title: 'Tarayıcınız bildirim desteklemiyor.' });
            return;
        }
        Notification.requestPermission().then(permission => {
            if (permission === "granted") {
                notifyBtn.style.display = 'none';
                Toast.fire({ icon: 'success', title: 'Bildirimler Aktif!', text: 'Artık yeni randevularda uyarı alacaksınız.' });
                navigator.serviceWorker.ready.then((registration) => {
                    registration.showNotification("✅ Harika!", {
                        body: "Bildirimler başarıyla aktif edildi.",
                        icon: "https://cdn-icons-png.flaticon.com/512/2838/2838779.png",
                        vibrate: [200, 100, 200]
                    });
                });
            } else {
                Swal.fire({ icon: 'warning', title: 'İzin Reddedildi', text: 'Telefon ayarlarından bildirim izni vermelisiniz.' });
            }
        });
    });
}
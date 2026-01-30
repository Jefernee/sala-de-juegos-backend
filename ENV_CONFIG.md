# 🔧 Configuración de Variables de Entorno

## 📁 Estructura de archivos .env

### Backend (`sala-juegos-backend/.env`)
```env
# Puerto del servidor
PORT=5000

# URL del frontend (para CORS)
# DESARROLLO: localhost con puerto donde corre el frontend
FRONTEND_URL=http://localhost:3000

# PRODUCCIÓN: URL de tu frontend desplegado
# FRONTEND_URL=https://tu-frontend.vercel.app

# MongoDB
MONGO_URI=mongodb+srv://usuario:password@cluster.mongodb.net/nombreDB

# Cloudinary (para imágenes)
CLOUDINARY_CLOUD_NAME=tu_cloud_name
CLOUDINARY_API_KEY=tu_api_key
CLOUDINARY_API_SECRET=tu_api_secret

# JWT (autenticación)
JWT_SECRET=tu_secreto_super_seguro_minimo_32_caracteres
```

### Frontend (`sala-juegos-frontend/.env`)
```env
# URL del backend API
# DESARROLLO: localhost donde corre el backend
REACT_APP_API_URL=http://localhost:5000

# PRODUCCIÓN: URL de tu backend desplegado
# REACT_APP_API_URL=https://tu-backend.onrender.com
```

---

## 🚀 Guía de Configuración

### Para Desarrollo Local:

1. **Backend** `.env`:
```env
   FRONTEND_URL=http://localhost:3000
```

2. **Frontend** `.env`:
```env
   REACT_APP_API_URL=http://localhost:5000
```

3. **Reiniciar AMBOS servidores** después de cambiar `.env`:
```bash
   # Terminal Backend
   Ctrl + C
   node server.js
   
   # Terminal Frontend
   Ctrl + C
   npm start
```

### Para Producción:

1. **Backend** `.env`:
```env
   FRONTEND_URL=https://tu-app-frontend.vercel.app
```

2. **Frontend** `.env` (o variables en Vercel/Netlify):
```env
   REACT_APP_API_URL=https://tu-backend.onrender.com
```

---

## ⚠️ Problemas Comunes

### ❌ "No puedo iniciar sesión"
**Causa:** CORS mal configurado
**Solución:** 
- Verifica que `FRONTEND_URL` en backend coincida con el puerto del frontend
- Reinicia el backend después de cambiar

### ❌ "Los logs no aparecen"
**Causa:** Frontend apunta a producción, no a localhost
**Solución:**
- Verifica `REACT_APP_API_URL` en frontend
- Borra caché: `Remove-Item -Recurse -Force node_modules/.cache`
- Reinicia frontend

### ❌ "Error de conexión a MongoDB"
**Causa:** `MONGO_URI` incorrecta o sin permisos de red
**Solución:**
- Verifica la URI en MongoDB Atlas
- Permite tu IP en MongoDB Network Access

---

## 🔍 Verificación Rápida

### En el navegador (DevTools → Console):
```javascript
// Verifica qué backend está usando el frontend
console.log(process.env.REACT_APP_API_URL)
```

### En Network tab:
Mira las URLs de las peticiones:
- `localhost:5000` → Usando local ✅
- `onrender.com` → Usando producción ❌ (si quieres local)

---

## 📌 Checklist antes de desarrollar:

- [ ] Backend corriendo (`node server.js`)
- [ ] Frontend corriendo (`npm start`)
- [ ] `.env` backend tiene `FRONTEND_URL=http://localhost:3000`
- [ ] `.env` frontend tiene `REACT_APP_API_URL=http://localhost:5000`
- [ ] Ambos reiniciados después de cambiar `.env`
- [ ] Puedes iniciar sesión ✅
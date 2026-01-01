# 🏪 Sistema de Inventario - Backend API

API RESTful para gestión de inventario con autenticación JWT, carga de imágenes a Cloudinary y operaciones CRUD completas.

## 🚀 Características

- ✅ Autenticación y autorización con JWT
- ✅ CRUD completo de productos
- ✅ Carga optimizada de imágenes a Cloudinary
- ✅ Paginación y búsqueda de productos
- ✅ Filtros por disponibilidad
- ✅ Productos públicos y privados
- ✅ Eliminación automática de imágenes en Cloudinary
- ✅ Validación de datos
- ✅ Gestión de usuarios

## 🛠️ Tecnologías

- **Node.js** - Entorno de ejecución
- **Express** - Framework web
- **MongoDB** - Base de datos NoSQL
- **Mongoose** - ODM para MongoDB
- **JWT** - Autenticación
- **Cloudinary** - Almacenamiento de imágenes
- **Multer** - Manejo de archivos
- **Bcrypt** - Encriptación de contraseñas

## 📋 Requisitos Previos

- Node.js >= 16.x
- MongoDB (local o Atlas)
- Cuenta en Cloudinary
- npm o yarn

## ⚙️ Instalación

### 1. Clonar el repositorio

```bash
git clone https://github.com/tu-usuario/tu-repo-backend.git
cd tu-repo-backend
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Configurar variables de entorno

Crea un archivo `.env` en la raíz del proyecto:

```env
# Base de datos
MONGODB_URI=mongodb+srv://<TU_USUARIO>:<TU_PASSWORD>@<TU_CLUSTER>.mongodb.net/inventario

# Puerto
PORT=5000

# JWT
JWT_SECRET=tu_clave_secreta_muy_segura_aqui

# Cloudinary
CLOUDINARY_CLOUD_NAME=tu_cloud_name
CLOUDINARY_API_KEY=tu_api_key
CLOUDINARY_API_SECRET=tu_api_secret

# CORS (opcional)
FRONTEND_URL=http://localhost:5173
```

### 4. Iniciar el servidor

#### Desarrollo
```bash
npm run dev
```

#### Producción
```bash
npm start
```

El servidor estará corriendo en `http://localhost:5000`

## 📁 Estructura del Proyecto

```
backend/
├── config/
│   └── cloudinary.js       # Configuración de Cloudinary
├── controllers/
│   ├── inventarioController.js  # Lógica de productos
│   └── authController.js        # Lógica de autenticación
├── models/
│   ├── Inventario.js       # Modelo de productos
│   └── Usuario.js          # Modelo de usuarios
├── routes/
│   ├── inventario.routes.js    # Rutas de productos
│   └── auth.routes.js          # Rutas de autenticación
├── middleware/
│   └── auth.js             # Middleware de autenticación
├── db.js                   # Conexión a MongoDB
├── server.js               # Archivo principal
├── .env                    # Variables de entorno (no subir)
├── .gitignore
├── package.json
└── README.md
```

## 🔌 API Endpoints

### Autenticación

| Método | Endpoint | Descripción | Auth |
|--------|----------|-------------|------|
| POST | `/api/auth/register` | Registrar usuario | ❌ |
| POST | `/api/auth/login` | Iniciar sesión | ❌ |
| GET | `/api/auth/verify` | Verificar token | ✅ |

### Productos

| Método | Endpoint | Descripción | Auth |
|--------|----------|-------------|------|
| GET | `/api/inventario` | Obtener todos los productos | ✅ |
| GET | `/api/inventario/paginado` | Productos paginados | ✅ |
| GET | `/api/inventario/publicos` | Productos disponibles (público) | ❌ |
| GET | `/api/inventario/para-venta` | Productos con stock disponible | ✅ |
| POST | `/api/inventario` | Crear producto | ✅ |
| PUT | `/api/inventario/:id` | Actualizar producto | ✅ |
| DELETE | `/api/inventario/:id` | Eliminar producto | ✅ |

### Ejemplos de Uso

#### Registrar usuario
```bash
POST /api/auth/register
Content-Type: application/json

{
  "nombre": "Juan Pérez",
  "email": "juan@example.com",
  "password": "password123"
}
```

#### Crear producto
```bash
POST /api/inventario
Authorization: Bearer tu_token_jwt
Content-Type: multipart/form-data

{
  "nombre": "Camisa Polo",
  "cantidad": 50,
  "precioCompra": 15000,
  "precioVenta": 25000,
  "fechaCompra": "2024-01-15",
  "seVende": true,
  "imagen": [archivo]
}
```

#### Obtener productos paginados
```bash
GET /api/inventario/paginado?page=1&limit=12&search=camisa&disponible=true
Authorization: Bearer tu_token_jwt
```

## 🔐 Autenticación

La API utiliza JWT (JSON Web Tokens) para autenticación. 

1. Registra un usuario en `/api/auth/register`
2. Inicia sesión en `/api/auth/login` para obtener el token
3. Incluye el token en el header de las peticiones protegidas:

```
Authorization: Bearer tu_token_aqui
```

## 🌐 Deploy en Render

### 1. Crear cuenta en Render.com

### 2. Conectar repositorio de GitHub

### 3. Configurar variables de entorno

### 3. Configurar variables de entorno

Crea un archivo `.env` en la raíz del proyecto:
```env
# Base de datos MongoDB Atlas
MONGODB_URI=mongodb+srv://<USUARIO>:<PASSWORD>@<CLUSTER>.mongodb.net/inventario

# Puerto del servidor
PORT=5000

# Clave secreta para JWT (genera una aleatoria y segura)
JWT_SECRET=tu_clave_secreta_muy_segura_aqui_cambiala

# Credenciales de Cloudinary
CLOUDINARY_CLOUD_NAME=tu_cloud_name_aqui
CLOUDINARY_API_KEY=tu_api_key_aqui
CLOUDINARY_API_SECRET=tu_api_secret_aqui

# URL del frontend para CORS
FRONTEND_URL=http://localhost:3000
```

**📌 Cómo obtener tu MONGODB_URI:**

1. Ve a [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Inicia sesión y selecciona tu cluster
3. Click en **"Connect"** → **"Connect your application"**
4. Copia la cadena de conexión
5. Reemplaza:
   - `<username>` con tu usuario de MongoDB
   - `<password>` con tu contraseña real
   - `<cluster>` quedará automáticamente
6. Agrega `/inventario` al final antes de los parámetros

### 4. Comando de build
```bash
npm install
```

### 5. Comando de inicio
```bash
npm start
npm node server
```

## 📦 Scripts Disponibles

```json
{
  "start": "node server.js",
  "dev": "nodemon server.js",
  "test": "jest"
}
```

## 🐛 Troubleshooting

### Error de conexión a MongoDB
```
Verifica que MONGODB_URI esté correctamente configurado
Asegúrate de que tu IP esté en la whitelist de MongoDB Atlas
```

### Imágenes no se suben a Cloudinary
```
Verifica las credenciales de Cloudinary
Asegúrate de que el folder "productos" exista
```

### Error 401 Unauthorized
```
Verifica que el token JWT sea válido
Asegúrate de incluir el header Authorization
```

## 🤝 Contribuir

1. Fork el proyecto
2. Crea una rama (`git checkout -b feature/nueva-funcionalidad`)
3. Commit tus cambios (`git commit -m 'Añadir nueva funcionalidad'`)
4. Push a la rama (`git push origin feature/nueva-funcionalidad`)
5. Abre un Pull Request

## 📄 Licencia

Este proyecto está bajo la Licencia MIT.

## 👤 Autor

**Tu Nombre**
- GitHub: [@tu-usuario](https://github.com/tu-usuario)
- Email: tu@email.com

## 🙏 Agradecimientos

- [Express](https://expressjs.com/)
- [MongoDB](https://www.mongodb.com/)
- [Cloudinary](https://cloudinary.com/)

---

⭐ Si este proyecto te fue útil, dale una estrella en GitHub
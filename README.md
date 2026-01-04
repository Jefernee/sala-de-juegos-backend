# 🏪 Sistema POS - Backend API

<div align="center">
  <img src="docs/images/logo.png" alt="Logo POS System" width="200"/>
  
  ### API RESTful completa para sistema de punto de venta
  
  [![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
  [![Express](https://img.shields.io/badge/Express-5.x-blue.svg)](https://expressjs.com/)
  [![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-green.svg)](https://www.mongodb.com/)
  [![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
  [![Deploy](https://img.shields.io/badge/Deploy-Render-blueviolet.svg)](https://render.com/)
  
  [Demo Live](https://sala-de-juegos-backend.onrender.com) • [Documentación](https://github.com/tu-usuario/tu-repo/wiki) • [Reportar Bug](https://github.com/tu-usuario/tu-repo/issues)
</div>

---

## 📋 Tabla de Contenidos

- [🎯 Características](#-características)
- [🛠️ Stack Tecnológico](#️-stack-tecnológico)
- [📁 Estructura del Proyecto](#-estructura-del-proyecto)
- [⚙️ Instalación](#️-instalación)
- [🔐 Variables de Entorno](#-variables-de-entorno)
- [🚀 Ejecución](#-ejecución)
- [📡 API Endpoints](#-api-endpoints)
- [💾 Modelos de Datos](#-modelos-de-datos)
- [🔒 Autenticación](#-autenticación)
- [🌐 Deploy en Render](#-deploy-en-render)
- [📊 Casos de Uso](#-casos-de-uso)
- [🐛 Troubleshooting](#-troubleshooting)

---

## 🎯 Características

### Sistema Completo de Punto de Venta

✅ **Gestión de Inventario**
- CRUD completo de productos
- Control de stock en tiempo real
- Productos públicos/privados (seVende)
- Carga de imágenes optimizadas a Cloudinary
- Alertas de stock bajo
- Búsqueda y filtrado avanzado
- Paginación eficiente

✅ **Sistema de Ventas**
- Registro de ventas con múltiples productos
- Validación automática de stock
- Cálculo de vuelto
- Actualización automática de inventario post-venta
- Historial completo de transacciones
- Estadísticas diarias y mensuales

✅ **Gestión de Pedidos**
- Sistema de pedidos de clientes
- Estados: pendiente → confirmado → completado
- Validación de disponibilidad
- Datos de contacto del cliente
- Seguimiento de pedidos

✅ **Reportes y Analytics**
- Dashboard con métricas en tiempo real
- Productos más y menos vendidos
- Control de stock bajo
- Gráficas de ventas por período
- Estadísticas de ganancias
- Reportes de inventario total vs vendible

✅ **Seguridad**
- Autenticación JWT
- Contraseñas hasheadas con bcrypt
- Middleware de protección de rutas
- Validaciones exhaustivas

---

## 🛠️ Stack Tecnológico

<div align="center">
  <img src="docs/images/arquitectura.png" alt="Arquitectura del Sistema" width="700"/>
  
  **Arquitectura del Sistema**
</div>

| Tecnología | Versión | Uso |
|-----------|---------|-----|
| **Node.js** | 18+ | Runtime de JavaScript |
| **Express** | 5.2.1 | Framework web |
| **MongoDB** | 7.0+ | Base de datos NoSQL |
| **Mongoose** | 9.0.2 | ODM para MongoDB |
| **JWT** | 9.0.3 | Autenticación con tokens |
| **Bcrypt** | 6.0.0 | Hash de contraseñas |
| **Cloudinary** | 2.8.0 | Almacenamiento de imágenes |
| **Multer** | 2.0.2 | Manejo de archivos |
| **Cors** | 2.8.5 | Permisos CORS |
| **Dotenv** | 17.2.3 | Variables de entorno |

---

## 📁 Estructura del Proyecto

```
backend/
├── config/
│   └── cloudinary.js           # Configuración de Cloudinary
├── controllers/
│   ├── inventarioController.js # Lógica de productos
│   ├── salesController.js      # Lógica de ventas
│   ├── pedidosController.js    # Lógica de pedidos
│   └── reportsController.js    # Lógica de reportes
├── middlewares/
│   ├── auth.js                 # Verificación JWT
│   └── upload.js               # Configuración Multer
├── models/
│   ├── Inventario.js           # Schema de productos
│   ├── User.js                 # Schema de usuarios
│   ├── sale.js                 # Schema de ventas
│   └── Pedido.js               # Schema de pedidos
├── routes/
│   ├── auth.js                 # Rutas de autenticación
│   ├── products.js             # Rutas de productos
│   ├── sales.js                # Rutas de ventas
│   ├── pedidos.js              # Rutas de pedidos
│   └── reports.js              # Rutas de reportes
├── .env                        # Variables de entorno (no incluir en Git)
├── .gitignore
├── db.js                       # Conexión a MongoDB
├── package.json
├── server.js                   # Punto de entrada
└── README.md
```

---

## ⚙️ Instalación

### 1. Clonar el repositorio

```bash
git clone https://github.com/tu-usuario/sala-de-juegos-backend.git
cd sala-de-juegos-backend
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Configurar MongoDB Atlas

1. Crea una cuenta en [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Crea un cluster gratuito
3. Configura un usuario de base de datos
4. Whitelist tu IP (o `0.0.0.0/0` para desarrollo)
5. Obtén tu connection string

---

## 🔐 Variables de Entorno

Crea un archivo `.env` en la raíz del proyecto:

```env
# Base de datos MongoDB Atlas
MONGO_URI=mongodb+srv://<USUARIO>:<PASSWORD>@<CLUSTER>.mongodb.net/pos_tienda?retryWrites=true&w=majority

# Puerto del servidor
PORT=5000

# JWT Secret (genera una clave segura)
JWT_SECRET=tu_clave_super_secreta_aqui_cambiala_por_una_real

# Cloudinary (obtén en cloudinary.com)
CLOUDINARY_CLOUD_NAME=tu_cloud_name
CLOUDINARY_API_KEY=tu_api_key
CLOUDINARY_API_SECRET=tu_api_secret

# Frontend URL (para CORS)
FRONTEND_URL=https://tu-frontend.vercel.app
```

### 📝 Notas importantes:

- **MONGO_URI**: Reemplaza `<USUARIO>`, `<PASSWORD>`, y `<CLUSTER>` con tus credenciales
- **JWT_SECRET**: Genera una clave aleatoria segura (mínimo 32 caracteres)
- **Cloudinary**: Crea una cuenta gratuita en [cloudinary.com](https://cloudinary.com)

---

## 🚀 Ejecución

### Desarrollo (con nodemon)

```bash
npm run dev
```

### Producción

```bash
npm start
```

El servidor estará disponible en `http://localhost:5000`

---

## 📡 API Endpoints

### 🔓 Autenticación

| Método | Endpoint | Descripción | Auth | Body |
|--------|----------|-------------|------|------|
| POST | `/api/auth/register` | Registrar usuario | ❌ | `{ email, password, nombre }` |
| POST | `/api/auth/login` | Iniciar sesión | ❌ | `{ email, password }` |
| GET | `/api/auth/verify` | Verificar token | ✅ | - |

#### Ejemplo: Registro

```bash
POST /api/auth/register
Content-Type: application/json

{
  "email": "admin@tienda.com",
  "password": "Password123",
  "nombre": "Administrador"
}
```

**Respuesta:**
```json
{
  "message": "Usuario creado exitosamente",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "admin@tienda.com",
    "nombre": "Administrador"
  }
}
```

#### Ejemplo: Login

```bash
POST /api/auth/login
Content-Type: application/json

{
  "email": "admin@tienda.com",
  "password": "Password123"
}
```

**Respuesta:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "admin@tienda.com",
    "nombre": "Administrador"
  }
}
```

<div align="center">
  <img src="docs/images/postman-login.png" alt="Login en Postman" width="800"/>
  
  **Ejemplo de Login en Postman**
</div>

---

### 📦 Productos (Inventario)

| Método | Endpoint | Descripción | Auth |
|--------|----------|-------------|------|
| GET | `/api/products` | Todos los productos | ✅ |
| GET | `/api/products/list` | Productos paginados | ✅ |
| GET | `/api/products/public` | Productos públicos | ❌ |
| GET | `/api/products/para-venta` | Productos con stock | ✅ |
| POST | `/api/products` | Crear producto | ✅ |
| PUT | `/api/products/:id` | Actualizar producto | ✅ |
| DELETE | `/api/products/:id` | Eliminar producto | ✅ |

#### Ejemplo: Crear Producto

```bash
POST /api/products
Authorization: Bearer <tu_token>
Content-Type: multipart/form-data

{
  "nombre": "Camisa Polo Azul",
  "cantidad": 50,
  "precioCompra": 15000,
  "precioVenta": 25000,
  "fechaCompra": "2024-01-15",
  "seVende": true,
  "imagen": [archivo.jpg]
}
```

**Respuesta:**
```json
{
  "_id": "507f1f77bcf86cd799439011",
  "nombre": "Camisa Polo Azul",
  "cantidad": 50,
  "precioCompra": 15000,
  "precioVenta": 25000,
  "fechaCompra": "2024-01-15T00:00:00.000Z",
  "imagen": "https://res.cloudinary.com/tu-cloud/image/upload/productos/abc123.jpg",
  "seVende": true,
  "createdBy": {
    "_id": "507f1f77bcf86cd799439011",
    "nombre": "Administrador",
    "email": "admin@tienda.com"
  },
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

#### Ejemplo: Productos Paginados

```bash
GET /api/products/list?page=1&limit=12&search=camisa&disponible=true
Authorization: Bearer <tu_token>
```

**Respuesta:**
```json
{
  "productos": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "nombre": "Camisa Polo Azul",
      "cantidad": 50,
      "precioVenta": 25000,
      "imagen": "https://...",
      "seVende": true
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 5,
    "totalProducts": 58,
    "productsPerPage": 12,
    "hasNextPage": true,
    "hasPrevPage": false
  }
}
```

---

### 💰 Ventas

| Método | Endpoint | Descripción | Auth |
|--------|----------|-------------|------|
| GET | `/api/sales` | Historial de ventas | ✅ |
| GET | `/api/sales/:id` | Detalle de venta | ✅ |
| POST | `/api/sales` | Registrar venta | ✅ |
| GET | `/api/sales/stats/summary` | Estadísticas | ✅ |

#### Ejemplo: Registrar Venta

```bash
POST /api/sales
Authorization: Bearer <tu_token>
Content-Type: application/json

{
  "productos": [
    {
      "productoId": "507f1f77bcf86cd799439011",
      "nombre": "Camisa Polo Azul",
      "cantidad": 2,
      "precioVenta": 25000,
      "subtotal": 50000
    },
    {
      "productoId": "507f1f77bcf86cd799439012",
      "nombre": "Pantalón Jean Negro",
      "cantidad": 1,
      "precioVenta": 35000,
      "subtotal": 35000
    }
  ],
  "total": 85000,
  "montoPagado": 100000,
  "vuelto": 15000,
  "fecha": "2024-01-15T14:30:00.000Z"
}
```

**Respuesta:**
```json
{
  "message": "Venta registrada exitosamente",
  "venta": {
    "_id": "507f1f77bcf86cd799439013",
    "productos": [...],
    "total": 85000,
    "montoPagado": 100000,
    "vuelto": 15000,
    "fecha": "2024-01-15T14:30:00.000Z",
    "createdAt": "2024-01-15T14:30:00.000Z"
  }
}
```

**Nota importante:** El sistema automáticamente:
- ✅ Valida que haya stock suficiente
- ✅ Verifica que los productos estén marcados como `seVende: true`
- ✅ Valida que los precios no hayan cambiado
- ✅ Actualiza el inventario restando las cantidades vendidas

<div align="center">
  <img src="docs/images/postman-venta.png" alt="Registrar Venta en Postman" width="800"/>
  
  **Flujo de Registro de Venta**
</div>

---

### 📋 Pedidos

| Método | Endpoint | Descripción | Auth |
|--------|----------|-------------|------|
| GET | `/api/pedidos` | Lista de pedidos | ✅ |
| GET | `/api/pedidos/:id` | Detalle de pedido | ✅ |
| POST | `/api/pedidos` | Crear pedido | ✅ |
| PATCH | `/api/pedidos/:id` | Actualizar estado | ✅ |
| DELETE | `/api/pedidos/:id` | Eliminar pedido | ✅ |

#### Ejemplo: Crear Pedido

```bash
POST /api/pedidos
Authorization: Bearer <tu_token>
Content-Type: application/json

{
  "productoId": "507f1f77bcf86cd799439011",
  "productoNombre": "Camisa Polo Azul",
  "precioVenta": 25000,
  "nombreCliente": "Juan Pérez",
  "telefono": "8888-8888",
  "email": "juan@example.com",
  "cantidad": 3,
  "total": 75000,
  "notas": "Entrega a domicilio"
}
```

**Respuesta:**
```json
{
  "message": "Pedido creado exitosamente",
  "pedido": {
    "_id": "507f1f77bcf86cd799439014",
    "productoId": "507f1f77bcf86cd799439011",
    "productoNombre": "Camisa Polo Azul",
    "nombreCliente": "Juan Pérez",
    "telefono": "8888-8888",
    "cantidad": 3,
    "total": 75000,
    "estado": "pendiente",
    "fechaPedido": "2024-01-15T15:00:00.000Z"
  }
}
```

#### Actualizar Estado de Pedido

```bash
PATCH /api/pedidos/507f1f77bcf86cd799439014
Authorization: Bearer <tu_token>
Content-Type: application/json

{
  "estado": "completado"
}
```

**Estados válidos:** `pendiente`, `confirmado`, `completado`, `cancelado`

---

### 📊 Reportes

| Método | Endpoint | Descripción | Auth |
|--------|----------|-------------|------|
| GET | `/api/reports/resumen` | Dashboard general | ✅ |
| GET | `/api/reports/mas-vendidos` | Top productos | ✅ |
| GET | `/api/reports/menos-vendidos` | Productos lentos | ✅ |
| GET | `/api/reports/stock-bajo` | Alertas de stock | ✅ |
| GET | `/api/reports/ventas-periodo` | Gráficas de ventas | ✅ |
| GET | `/api/reports/pedidos-stats` | Stats de pedidos | ✅ |

#### Ejemplo: Dashboard General

```bash
GET /api/reports/resumen
Authorization: Bearer <tu_token>
```

**Respuesta:**
```json
{
  "ventasHoy": {
    "total": 250000,
    "cantidad": 8
  },
  "ventasSemana": {
    "total": 1500000,
    "cantidad": 45
  },
  "ventasMes": {
    "total": 6500000,
    "cantidad": 180,
    "ganancias": 2800000
  },
  "inventarioTotal": {
    "valorTotal": 15000000,
    "totalProductos": 120,
    "totalUnidades": 850
  },
  "inventarioVenta": {
    "valorTotal": 12000000,
    "totalProductos": 95,
    "totalUnidades": 680,
    "stockBajo": 8,
    "agotados": 3
  },
  "pedidosPendientes": 12
}
```

<div align="center">
  <img src="docs/images/dashboard.png" alt="Dashboard de Reportes" width="800"/>
  
  **Vista del Dashboard con Métricas en Tiempo Real**
</div>

#### Ejemplo: Productos Más Vendidos

```bash
GET /api/reports/mas-vendidos?limit=10&days=30
Authorization: Bearer <tu_token>
```

**Respuesta:**
```json
{
  "periodo": "Últimos 30 días",
  "productos": [
    {
      "nombre": "Camisa Polo Azul",
      "cantidadVendida": 45,
      "totalVentas": 1125000
    },
    {
      "nombre": "Pantalón Jean Negro",
      "cantidadVendida": 38,
      "totalVentas": 1330000
    }
  ]
}
```

#### Ejemplo: Stock Bajo

```bash
GET /api/reports/stock-bajo?threshold=5&limit=20
Authorization: Bearer <tu_token>
```

**Respuesta:**
```json
{
  "stockBajo": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "nombre": "Camisa Polo Roja",
      "cantidad": 3,
      "precioVenta": 25000
    }
  ],
  "agotados": [
    {
      "_id": "507f1f77bcf86cd799439012",
      "nombre": "Zapatos Deportivos",
      "cantidad": 0,
      "precioVenta": 45000
    }
  ],
  "umbral": 5
}
```

---

## 💾 Modelos de Datos

### User (Usuario)

```javascript
{
  _id: ObjectId,
  email: String (unique, required),
  password: String (hashed, required),
  nombre: String,
  createdAt: Date (default: now)
}
```

### Inventario (Producto)

```javascript
{
  _id: ObjectId,
  nombre: String (required),
  cantidad: Number (required),
  precioCompra: Number (required),
  precioVenta: Number (required),
  fechaCompra: Date (required),
  imagen: String (Cloudinary URL),
  seVende: Boolean (default: true),
  createdBy: ObjectId (ref: 'User', required),
  createdAt: Date (immutable),
  updatedAt: Date
}
```

**Índices:**
- `nombre` (búsqueda rápida)
- `seVende` (filtrado de disponibles)
- `seVende + nombre` (búsqueda de disponibles)
- `createdBy` (productos por usuario)
- `createdAt` (orden cronológico)

### Sale (Venta)

```javascript
{
  _id: ObjectId,
  productos: [{
    productoId: ObjectId (ref: 'Inventario'),
    nombre: String,
    cantidad: Number,
    precioVenta: Number,
    subtotal: Number
  }],
  total: Number (required),
  montoPagado: Number (required),
  vuelto: Number (required),
  fecha: Date (default: now),
  createdAt: Date,
  updatedAt: Date
}
```

**Índices:**
- `fecha` (consultas por período)
- `productos.productoId` (reportes de productos)

### Pedido

```javascript
{
  _id: ObjectId,
  productoId: ObjectId (ref: 'Inventario', required),
  productoNombre: String (required),
  precioVenta: Number (required),
  nombreCliente: String (required),
  telefono: String (required),
  email: String,
  cantidad: Number (min: 1, required),
  total: Number (required),
  notas: String,
  estado: String (enum: ['pendiente', 'confirmado', 'completado', 'cancelado']),
  fechaPedido: Date (default: now),
  createdAt: Date,
  updatedAt: Date
}
```

---

## 🔒 Autenticación

### JWT (JSON Web Tokens)

Todas las rutas protegidas requieren un token JWT válido en el header:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Flujo de Autenticación

<div align="center">
  <img src="docs/images/flujo-auth.png" alt="Flujo de Autenticación" width="700"/>
  
  **Diagrama de Flujo de Autenticación JWT**
</div>

```mermaid
sequenceDiagram
    Cliente->>API: POST /api/auth/login
    API->>MongoDB: Verificar credenciales
    MongoDB-->>API: Usuario encontrado
    API->>API: Generar JWT
    API-->>Cliente: { token, user }
    Cliente->>API: GET /api/products (con token)
    API->>Middleware: Verificar token
    Middleware-->>API: Usuario válido
    API-->>Cliente: Datos de productos
```

### Middleware de Autenticación

```javascript
// middlewares/auth.js
export default (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ error: 'Acceso denegado' });
  }
  
  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.user = verified;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Token inválido' });
  }
};
```

---

## 🌐 Deploy en Render

### 1. Preparar el Proyecto

Asegúrate de tener:
- ✅ `package.json` con script `"start": "node server.js"`
- ✅ `.gitignore` que excluya `node_modules/` y `.env`
- ✅ Código subido a GitHub

### 2. Crear Servicio en Render

1. Ingresa a [render.com](https://render.com)
2. Click en **"New +"** → **"Web Service"**
3. Conecta tu repositorio de GitHub
4. Configura:
   - **Name:** `sala-de-juegos-backend`
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** `Free`

### 3. Variables de Entorno

Agrega en Render (Environment):

```
MONGO_URI=mongodb+srv://usuario:password@cluster.mongodb.net/pos_tienda
JWT_SECRET=tu_clave_secreta_aqui
CLOUDINARY_CLOUD_NAME=tu_cloud_name
CLOUDINARY_API_KEY=tu_api_key
CLOUDINARY_API_SECRET=tu_api_secret
PORT=5000
FRONTEND_URL=https://tu-frontend.vercel.app
```

### 4. Deploy Automático

Render detectará automáticamente los cambios en tu rama principal y desplegará.

**URL del backend:** `https://sala-de-juegos-backend.onrender.com`

### 5. Configurar CORS

En `server.js`:

```javascript
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
```

---

## 📊 Casos de Uso

### Caso 1: Registrar una Venta

**Flujo completo:**

1. **Frontend solicita productos disponibles**
```bash
GET /api/products/para-venta?search=camisa
```

2. **Cliente selecciona productos y confirma venta**
```bash
POST /api/sales
{
  "productos": [
    {
      "productoId": "abc123",
      "nombre": "Camisa Polo",
      "cantidad": 2,
      "precioVenta": 25000,
      "subtotal": 50000
    }
  ],
  "total": 50000,
  "montoPagado": 50000,
  "vuelto": 0
}
```

3. **Backend automáticamente:**
   - ✅ Valida stock disponible
   - ✅ Verifica que productos estén marcados como `seVende: true`
   - ✅ Valida precios actuales
   - ✅ Calcula vuelto
   - ✅ Registra la venta
   - ✅ Actualiza inventario (resta cantidades vendidas)

### Caso 2: Alertas de Stock Bajo

**Consulta diaria automática:**

```bash
GET /api/reports/stock-bajo?threshold=5
```

El sistema retorna productos con menos de 5 unidades para reabastecimiento.

### Caso 3: Análisis de Ventas

**Dashboard administrativo:**

```bash
# Resumen general
GET /api/reports/resumen

# Top 10 productos del mes
GET /api/reports/mas-vendidos?limit=10&days=30

# Productos de lenta rotación
GET /api/reports/menos-vendidos?limit=10&days=30&maxSales=2

# Gráfica de ventas últimos 30 días
GET /api/reports/ventas-periodo?days=30
```

---

## 🐛 Troubleshooting

### Error: "Cannot connect to MongoDB"

**Solución:**
1. Verifica que `MONGO_URI` esté correcta en `.env`
2. Whitelist tu IP en MongoDB Atlas
3. Asegúrate que el usuario tenga permisos de lectura/escritura

### Error: "JWT malformed"

**Solución:**
1. Verifica que el token se envíe con formato: `Bearer <token>`
2. Asegúrate que `JWT_SECRET` sea el mismo en toda la aplicación

### Error: "Producto no encontrado" al vender

**Causa:** El producto fue eliminado antes de completar la venta.

**Solución:** Implementar soft-delete o validar disponibilidad antes de mostrar al cliente.

### Error: "Stock insuficiente"

**Causa:** Otro usuario vendió el producto antes de completar la transacción actual.

**Solución:** El sistema automáticamente rechaza la venta. Frontend debe manejar este error y actualizar el carrito.

### Imágenes no se suben a Cloudinary

**Solución:**
1. Verifica credenciales de Cloudinary
2. Asegúrate que la carpeta "productos" exista
3. Revisa logs del servidor para errores específicos

### Error 401 en todas las rutas protegidas

**Solución:**
1. Verifica que el token JWT no haya expirado (24h por defecto)
2. Asegúrate de incluir el header `Authorization: Bearer <token>`
3. Revisa que `JWT_SECRET` sea consistente

---

## 📝 Scripts Disponibles

```json
{
  "start": "node server.js",       // Producción
  "dev": "nodemon server.js",      // Desarrollo con auto-reload
  "test": "jest"                    // Tests (por implementar)
}
```

---

## 🤝 Contribuir

1. Fork el proyecto
2. Crea una rama: `git checkout -b feature/nueva-funcionalidad`
3. Commit: `git commit -m 'Añadir nueva funcionalidad'`
4. Push: `git push origin feature/nueva-funcionalidad`
5. Abre un Pull Request

---

## 📄 Licencia

Este proyecto está bajo la Licencia MIT. Ver archivo `LICENSE` para más detalles.

---

## 👥 Equipo

**Desarrollador Principal:** Tu Nombre
- GitHub: [@tu-usuario](https://github.com/tu-usuario)
- Email: tu@email.com

---

## 🙏 Agradecimientos

- [Express.js](https://expressjs.com/) - Framework web
- [MongoDB](https://www.mongodb.com/) - Base de datos
- [Cloudinary](https://cloudinary.com/) - Almacenamiento de imágenes
- [JWT.io](https://jwt.io/) - Autenticación con tokens
- [Render](https://render.com/) - Plataforma de deploy

---

## 📞 Soporte

¿Tienes problemas? Abre un [issue en GitHub](https://github.com/tu-usuario/tu-repo/issues) o contáctanos.

---

⭐ **Si este proyecto te fue útil, dale una estrella en GitHub**

**Última actualización:** Enero 2025
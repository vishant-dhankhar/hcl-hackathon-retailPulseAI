import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { roles } from '../middleware/authorize.js';
import * as controller from '../controllers/catalogue.controller.js';
export const catalogueRoutes = Router();
catalogueRoutes.get('/stores', controller.listStores);
catalogueRoutes.get('/products', controller.listProducts);
catalogueRoutes.get('/products/:id', controller.getProduct);

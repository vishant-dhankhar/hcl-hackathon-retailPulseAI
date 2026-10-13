import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { roles } from '../middleware/authorize.js';
import * as controller from '../controllers/shopping.controller.js';
export const shoppingRoutes = Router();
shoppingRoutes.use(authenticate);
shoppingRoutes.get('/cart', roles('CUSTOMER'), controller.getCart);
shoppingRoutes.put('/cart/:productId', roles('CUSTOMER'), controller.updateCart);
shoppingRoutes.post('/checkout/quote', roles('CUSTOMER'), controller.getQuote);
shoppingRoutes.post('/checkout', roles('CUSTOMER'), controller.checkout);
shoppingRoutes.get('/orders', controller.listOrders);
shoppingRoutes.patch('/orders/:id/status', controller.updateOrderStatus);
shoppingRoutes.get('/support/tickets', controller.listTickets);
shoppingRoutes.post('/support/tickets', roles('CUSTOMER'), controller.createTicket);
shoppingRoutes.post(
  '/support/tickets/:id/replies',
  roles('STORE_MANAGER', 'ADMIN'),
  controller.replyToTicket,
);
shoppingRoutes.patch(
  '/support/tickets/:id',
  roles('STORE_MANAGER', 'ADMIN'),
  controller.updateTicket,
);

const async = require('async');
const Stripe = require('stripe');

const StripeProduction = Stripe(process.env.STRIPE_SK, { apiVersion: '2020-08-27' });
const StripeTest = Stripe(process.env.STRIPE_SK_TEST, { apiVersion: '2020-08-27' });

const passport = require('../middleware/passport');

const { passportAuth } = passport;

module.exports = (Router, Service) => {
  Router.get('/plans', passportAuth, (req, res) => {
    Service.Plan.ListAll().then((data) => {
      res.status(200).json(data);
    }).catch(() => {
      res.status(400).json({ message: 'Error retrieving list of plans' });
    });
  });

  /**
   * Should create a new Stripe Session token.
   * Stripe Session is neccesary to perform a new payment
   */
  Router.post('/stripe/session', passportAuth, (req, res) => {
    const stripe = req.body.test ? StripeTest : StripeProduction;

    const user = req.user.email;

    async.waterfall([
      (next) => {
        // Retrieve the customer by email, to check if already exists
        stripe.customers.list({
          limit: 1,
          email: user
        }, (err, customers) => {
          next(err, customers.data[0]);
        });
      },
      (customer, next) => {
        if (!customer) {
          // The customer does not exists
          // Procede to the subscription
          return next(null, undefined);
        }
        // Get subscriptions
        return stripe.subscriptions.list({
          customer: customer.id
        }, (err, response) => {
          if (err) {
            return next();
          }
          const subscriptions = response.data;
          if (subscriptions.length === 0) {
            return next(null, { customer, subscription: null });
          }
          const subscription = subscriptions[0];
          return next(null, { customer, subscription });
        });
      },
      (payload, next) => {
        if (!payload) {
          next(null, {});
        } else {
          const { customer, subscription } = payload;

          if (subscription) {
            next(Error('Already subscribed'));
          } else {
            next(null, customer);
          }
        }
      },
      (customer, next) => {
        // Open session
        const customerId = customer !== null ? customer.id || null : null;

        const sessionParams = {
          payment_method_types: ['card'],
          success_url: req.body.SUCCESS_URL || 'https://drive.internxt.com/',
          cancel_url: req.body.CANCELED_URL || 'https://drive.internxt.com/',
          subscription_data: {
            items: [{ plan: req.body.plan }]
          },
          customer_email: user,
          customer: customerId,
          allow_promotion_codes: true,
          billing_address_collection: 'required'
        };

        if (sessionParams.customer) {
          delete sessionParams.customer_email;
        } else {
          delete sessionParams.customer;
        }

        stripe.checkout.sessions.create(sessionParams).then((result) => { next(null, result); }).catch((err) => { next(err); });
      }
    ], (err, result) => {
      if (err) {
        res.status(500).send({ error: err.message });
      } else {
        res.status(200).send(result);
      }
    });
  });

  /**
   * Should create a new Stripe Session token.
   * Stripe Session is neccesary to perform a new payment
   */
  Router.post('/stripe/teams/session', passportAuth, async (req, res) => {
    const test = req.body.test || false;
    const stripe = test ? StripeTest : StripeProduction;
    const { quantity } = req.body;

    async.waterfall([
      async () => {
        return Service.Team.getTeamByEmail(req.user.email);
      },
      async (bridgeUser) => {
        if (!bridgeUser) {
          const newRandomTeam = Service.Team.randomEmailBridgeUserTeam();
          const newTeam = Service.Team.create({
            name: 'My team',
            admin: req.user.email,
            bridge_user: newRandomTeam.bridge_user,
            bridge_password: newRandomTeam.password,
            bridge_mnemonic: req.body.mnemonicTeam
          });
          return newTeam;
        }
        return bridgeUser;
      },
      async (bridgeUser) => {
        const sessionParams = {
          payment_method_types: ['card'],
          success_url: `${process.env.HOST_DRIVE_WEB}/team/success/{CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.HOST_DRIVE_WEB}/team/cancel`,
          subscription_data: {
            items: [
              {
                plan: req.body.plan,
                quantity
              }
            ]
          },
          metadata: {
            is_teams: true,
            total_members: quantity,
            team_email: bridgeUser.bridge_user,
            admin_email: req.user.email
          },
          customer_email: req.user.email,
          allow_promotion_codes: true,
          billing_address_collection: 'required'
        };

        if (sessionParams.customer) {
          delete sessionParams.customer_email;
        } else {
          delete sessionParams.customer;
        }

        return stripe.checkout.sessions.create(sessionParams);
      }
    ], (err, result) => {
      if (err) {
        res.status(500).send({ error: err.message });
      } else {
        res.status(200).send(result);
      }
    });
  });

  /**
   * Retrieve products listed in STRIPE.
   * Products must be inserted on stripe using the dashboard with the required metadata.
   * Required metadata:
   */
  Router.get('/stripe/products', passportAuth, (req, res) => {
    const test = req.query.test || false;

    Service.Stripe.getStorageProducts(test).then((products) => {
      res.status(200).send(products);
    }).catch((err) => {
      res.status(500).send({ error: err });
    });
  });

  Router.get('/stripe/teams/products', passportAuth, (req, res) => {
    const test = req.query.test || false;

    Service.Stripe.getTeamProducts(test).then((products) => {
      res.status(200).send(products);
    }).catch((err) => {
      res.status(500).send({ error: err });
    });
  });

  /**
   * Get available plans from a given product.
   * TODO: cache plans to avoid repetitive api calls
   */
  Router.post('/stripe/plans', passportAuth, (req, res) => {
    const stripe = req.body.test ? StripeTest : StripeProduction;
    const stripeProduct = req.body.product;

    stripe.plans.list({
      product: stripeProduct,
      active: true
    }, (err, plans) => {
      if (err) {
        res.status(500).send({ error: err.message });
      } else {
        const plansMin = plans.data
          .map((p) => ({
            id: p.id,
            price: p.amount,
            name: p.nickname,
            interval: p.interval,
            interval_count: p.interval_count
          }))
          .sort((a, b) => a.price * 1 - b.price * 1);
        res.status(200).send(plansMin);
      }
    });
  });

  Router.post('/stripe/teams/plans', passportAuth, (req, res) => {
    const stripeProduct = req.body.product;
    const test = req.body.test || false;

    Service.Stripe.getTeamPlans(stripeProduct, test).then((plans) => {
      res.status(200).send(plans);
    }).catch((err) => {
      res.status(500).send({ error: err.message });
    });
  });
};

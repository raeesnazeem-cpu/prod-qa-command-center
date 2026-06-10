import { Page as PlaywrightPage } from 'playwright';
import { Finding } from '@qacc/shared';

export async function checkWooCommerce(
  page: PlaywrightPage,
  baseUrl: string,
  runRecord: any
): Promise<Finding[]> {
  // Only runs if run.is_woocommerce === true
  if (!runRecord?.is_woocommerce) {
    return [];
  }

  const findings: Finding[] = [];
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

  try {
    // 1. Product pages check
    await page.goto(`${normalizedBaseUrl}/shop`, { waitUntil: 'networkidle', timeout: 30000 });
    
    const productLinks = await page.$$eval('.product a', (links) => 
      links.map(l => (l as HTMLAnchorElement).href)
    );

    const productsToTest = productLinks.slice(0, 5);
    for (const productUrl of productsToTest) {
      await page.goto(productUrl, { waitUntil: 'networkidle', timeout: 30000 });

      const checks = [
        { selector: '.product_title', name: 'Product title' },
        { selector: '.price', name: 'Product price' },
        { selector: '.add_to_cart_button', name: 'Add to cart button' }
      ];

      for (const check of checks) {
        const element = await page.$(check.selector);
        if (!element) {
          findings.push({
            check_factor: 'woocommerce',
            severity: 'medium',
            title: `Missing WooCommerce element: ${check.name}`,
            description: `${check.name} was not found on product page: ${productUrl}`,
            status: 'open',
            ai_generated: false
          } as Finding);
        }
      }

      // Check product image has alt attr
      const images = await page.$$('.wp-post-image');
      for (const img of images) {
        const alt = await img.getAttribute('alt');
        if (alt === null || alt.trim() === '') {
          findings.push({
            check_factor: 'woocommerce',
            severity: 'medium',
            title: 'WooCommerce product image missing alt text',
            description: `Product image on ${productUrl} is missing an alt attribute.`,
            status: 'open',
            ai_generated: false
          } as Finding);
        }
      }
    }

    // 2. Cart check
    if (productsToTest.length > 0) {
      await page.goto(productsToTest[0], { waitUntil: 'networkidle', timeout: 30000 });
      const addToCart = await page.$('.single_add_to_cart_button');
      if (addToCart) {
        await addToCart.click();
        await page.waitForTimeout(2000); // Wait for AJAX if any
      }

      await page.goto(`${normalizedBaseUrl}/cart`, { waitUntil: 'networkidle', timeout: 30000 });
      
      // Check cart not empty
      const emptyCart = await page.$('.cart-empty');
      if (emptyCart) {
        findings.push({
          check_factor: 'woocommerce',
          severity: 'medium',
          title: 'WooCommerce cart appears empty after adding product',
          description: 'The cart page shows as empty even after clicking "Add to cart".',
          status: 'open',
          ai_generated: false
        } as Finding);
      }

      // Quantity input present
      const quantityInput = await page.$('.qty');
      if (!quantityInput) {
        findings.push({
          check_factor: 'woocommerce',
          severity: 'medium',
          title: 'Missing WooCommerce element: Quantity input',
          description: 'Quantity input was not found on the cart page.',
          status: 'open',
          ai_generated: false
        } as Finding);
      }

      // Proceed to checkout button present
      const checkoutButton = await page.$('.checkout-button');
      if (!checkoutButton) {
        findings.push({
          check_factor: 'woocommerce',
          severity: 'medium',
          title: 'Missing WooCommerce element: Proceed to checkout button',
          description: 'Proceed to checkout button was not found on the cart page.',
          status: 'open',
          ai_generated: false
        } as Finding);
      }
    }

    // 3. Checkout check
    await page.goto(`${normalizedBaseUrl}/checkout`, { waitUntil: 'networkidle', timeout: 30000 });

    const checkoutChecks = [
      { selector: '#billing_first_name', name: 'Billing first name field' },
      { selector: '#billing_email', name: 'Billing email field' },
      { selector: '#billing_address_1', name: 'Billing address field' },
      { selector: '.payment_methods', name: 'Payment methods section' }
    ];

    for (const check of checkoutChecks) {
      const element = await page.$(check.selector);
      if (!element) {
        findings.push({
          check_factor: 'woocommerce',
          severity: 'medium',
          title: `Missing WooCommerce element: ${check.name}`,
          description: `${check.name} was not found on the checkout page.`,
          status: 'open',
          ai_generated: false
        } as Finding);
      }
    }

    // Verify HTTPS
    if (!page.url().startsWith('https')) {
      findings.push({
        check_factor: 'woocommerce',
        severity: 'medium',
        title: 'WooCommerce checkout not using HTTPS',
        description: 'The checkout page URL does not start with https://, which is a security risk.',
        status: 'open',
        ai_generated: false
      } as Finding);
    }

  } catch (error: any) {
    console.error('Error during WooCommerce check:', error.message);
  }

  return findings;
}

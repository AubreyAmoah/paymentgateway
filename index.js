require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { PrismaClient } = require('./generated/prisma');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const prisma = new PrismaClient();

// Helper function to generate transactionID with MSH- prefix and timestamp
function generateTransactionID() {
  const timestamp = Date.now();
  return `MSH-${timestamp}`;
}

// Helper function to map network name to bank code
function getNetworkBankCode(network) {
  const networkUpper = network.toUpperCase().trim();

  const networkMap = {
    'MTN': process.env.MTN_BANK_CODE,
    'AIRTELTIGO': process.env.AIRTELTIGO_BANK_CODE,
    'TELECEL': process.env.TELECEL_BANK_CODE
  };

  const bankCode = networkMap[networkUpper];

  if (!bankCode) {
    throw new Error(`Invalid network: ${network}. Supported networks: MTN, AirtelTigo, Telecel`);
  }

  return bankCode;
}

// Helper function to authenticate and get token
async function authenticate() {
  try {
    const response = await axios.post(process.env.AUTH_API_URL, {
      username: process.env.USERNAME,
      userpassword: process.env.PASSWORD
    });

    console.log('Authentication response status:', response.status);
    console.log('Authentication response data:', JSON.stringify(response.data, null, 2));

    // Try different possible token field names
    const token = response.data?.result ||
                  response.data?.token ||
                  response.data?.Token ||
                  response.data?.accessToken ||
                  response.data?.access_token ||
                  response.data?.data?.token ||
                  response.data?.data?.Token;

    if (token) {
      console.log('Token extracted successfully');
      return token;
    }

    throw new Error(`Authentication failed: No token found in response. Response: ${JSON.stringify(response.data)}`);
  } catch (error) {
    if (error.response) {
      console.error('Authentication API error:', error.response.status, error.response.data);
      throw new Error(`Authentication error: ${error.response.data?.message || JSON.stringify(error.response.data)}`);
    }
    throw new Error(`Authentication error: ${error.message}`);
  }
}

// Helper function to perform name enquiry
async function performNameEnquiry(token, partnerCode, transactionID, bankCode, necAccount) {
  try {
    console.log('Name enquiry request params:', {
      PartnerCode: partnerCode,
      TransactionID: transactionID,
      BankCode: bankCode,
      NECAccount: necAccount
    });

    const response = await axios.get(process.env.NAME_ENQUIRY_API_URL, {
      params: {
        PartnerCode: partnerCode,
        TransactionID: transactionID,
        BankCode: bankCode,
        NECAccount: necAccount
      },
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    console.log('Name enquiry response status:', response.status);
    console.log('Name enquiry response data:', JSON.stringify(response.data, null, 2));

    return response.data;
  } catch (error) {
    if (error.response) {
      console.error('Name enquiry API error:', error.response.status, error.response.data);
      throw new Error(`Name enquiry error: ${error.response.data?.message || JSON.stringify(error.response.data)}`);
    }
    throw new Error(`Name enquiry error: ${error.message}`);
  }
}

// Helper function to process collection
async function processCollection(token, paymentData, destBank) {
  try {
    const requestBody = {
      PartnerCode: process.env.PARTNER_CODE,
      DestBank: destBank,
      Accountnumber: paymentData.accountNumber,
      AccountName: paymentData.accountName,
      Amount: paymentData.amount,
      TransactionID: paymentData.transactionID,
      narration: paymentData.narration
    };

    console.log('Collection request body:', JSON.stringify(requestBody, null, 2));

    const response = await axios.post(process.env.COLLECTION_API_URL, requestBody, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('Collection response status:', response.status);
    console.log('Collection response data:', JSON.stringify(response.data, null, 2));

    return response.data;
  } catch (error) {
    if (error.response) {
      console.error('Collection API error:', error.response.status, error.response.data);
      throw new Error(`Collection error: ${error.response.data?.message || JSON.stringify(error.response.data)}`);
    }
    throw new Error(`Collection error: ${error.message}`);
  }
}

// Main payment route
app.post('/pay', async (req, res) => {
  let payment = null;

  try {
    // Validate required fields
    const { accountNumber, amount, narration, network, eventId, registrationId } = req.body;

    if (!accountNumber || !amount || !network) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: accountNumber, amount, network'
      });
    }

    // Generate separate transaction IDs for name enquiry and collection
    const nameEnquiryTransactionID = generateTransactionID();
    console.log('Generated Name Enquiry TransactionID:', nameEnquiryTransactionID);

    // Wait a moment to ensure different timestamp
    await new Promise(resolve => setTimeout(resolve, 10));

    const collectionTransactionID = generateTransactionID();
    console.log('Generated Collection TransactionID:', collectionTransactionID);

    // Get bank code from network name
    let bankCode;
    try {
      bankCode = getNetworkBankCode(network);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    // Step 1: Authenticate and get token
    console.log('Step 1: Authenticating...');
    const token = await authenticate();
    console.log('Authentication successful');

    // Step 2: Perform name enquiry to verify account
    console.log('Step 2: Performing name enquiry...');
    const nameEnquiryResult = await performNameEnquiry(
      token,
      process.env.PARTNER_CODE,
      nameEnquiryTransactionID,
      bankCode,
      accountNumber
    );
    console.log('Name enquiry successful:', nameEnquiryResult);

    // Extract account name from name enquiry result
    const accountName = nameEnquiryResult.data?.nametocredit ||
                        nameEnquiryResult.data?.NameToCredit ||
                        nameEnquiryResult.nametocredit ||
                        nameEnquiryResult.accountName ||
                        nameEnquiryResult.AccountName ||
                        nameEnquiryResult.name ||
                        nameEnquiryResult.Name;

    if (!accountName) {
      throw new Error('Account name not found in name enquiry response');
    }

    console.log('Verified Account Name:', accountName);

    // Create payment record in database with pending status
    payment = await prisma.payment.create({
      data: {
        transactionId: collectionTransactionID,
        nameEnquiryTransactionId: nameEnquiryTransactionID,
        partnerCode: process.env.PARTNER_CODE,
        destBank: bankCode,
        accountNumber: accountNumber,
        accountName: accountName,
        amount: parseFloat(amount),
        narration: narration || 'Payment Gateway Transaction',
        status: 'pending',
        verificationResponse: JSON.stringify(nameEnquiryResult),
        eventId: eventId ? parseInt(eventId) : null,
        registrationId: registrationId ? parseInt(registrationId) : null,
      }
    });

    console.log('Payment record created with ID:', payment.id.toString());

    // Step 3: Update status to processing
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'processing' }
    });

    // Step 4: Process the collection
    console.log('Step 3: Processing collection...');
    const collectionResult = await processCollection(token, {
      accountNumber,
      accountName,
      amount,
      transactionID: collectionTransactionID,
      narration: narration || 'Payment Gateway Transaction'
    }, bankCode);
    console.log('Collection successful:', collectionResult);

    // Determine payment status from collection result
    const collectionStatus = collectionResult?.message?.status || collectionResult?.data?.status;
    const isSuccess = collectionStatus === '000' || collectionStatus === '0';

    // Update payment record with final status
    payment = await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: isSuccess ? 'completed' : 'failed',
        response: JSON.stringify(collectionResult),
        completedAt: new Date()
      }
    });

    console.log('Payment record updated to status:', payment.status);

    // Return success response
    res.status(200).json({
      success: true,
      message: 'Payment processed successfully',
      paymentId: payment.id.toString(),
      nameEnquiryTransactionID: nameEnquiryTransactionID,
      collectionTransactionID: collectionTransactionID,
      status: payment.status,
      data: {
        nameEnquiry: nameEnquiryResult,
        collection: collectionResult
      }
    });

  } catch (error) {
    console.error('Payment processing error:', error.message);

    // Update payment record to failed if it was created
    if (payment) {
      try {
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: 'failed',
            response: JSON.stringify({ error: error.message }),
            completedAt: new Date()
          }
        });
      } catch (dbError) {
        console.error('Failed to update payment status:', dbError.message);
      }
    }

    res.status(500).json({
      success: false,
      message: 'Payment processing failed',
      error: error.message
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'Payment Gateway is running',
    timestamp: new Date().toISOString()
  });
});

// Get payment by transaction ID
app.get('/payment/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params;

    const payment = await prisma.payment.findUnique({
      where: { transactionId: transactionId }
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    res.status(200).json({
      success: true,
      payment: {
        ...payment,
        id: payment.id.toString(),
        eventId: payment.eventId?.toString(),
        registrationId: payment.registrationId?.toString(),
        response: payment.response ? JSON.parse(payment.response) : null,
        verificationResponse: payment.verificationResponse ? JSON.parse(payment.verificationResponse) : null
      }
    });
  } catch (error) {
    console.error('Error fetching payment:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment',
      error: error.message
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Payment Gateway server is running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Payment endpoint: http://localhost:${PORT}/pay`);
  console.log(`Query payment: http://localhost:${PORT}/payment/:transactionId`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

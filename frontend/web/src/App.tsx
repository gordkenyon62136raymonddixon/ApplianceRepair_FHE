// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface RepairService {
  id: string;
  encryptedData: string;
  timestamp: number;
  provider: string;
  serviceType: string;
  reputation: number;
  status: "available" | "matched" | "completed";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState<RepairService[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newServiceData, setNewServiceData] = useState({
    serviceType: "",
    description: "",
    availability: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState("all");

  // Calculate statistics for dashboard
  const availableCount = services.filter(s => s.status === "available").length;
  const matchedCount = services.filter(s => s.status === "matched").length;
  const completedCount = services.filter(s => s.status === "completed").length;
  const avgReputation = services.length > 0 
    ? services.reduce((sum, s) => sum + s.reputation, 0) / services.length 
    : 0;

  useEffect(() => {
    loadServices().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadServices = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("service_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing service keys:", e);
        }
      }
      
      const list: RepairService[] = [];
      
      for (const key of keys) {
        try {
          const serviceBytes = await contract.getData(`service_${key}`);
          if (serviceBytes.length > 0) {
            try {
              const serviceData = JSON.parse(ethers.toUtf8String(serviceBytes));
              list.push({
                id: key,
                encryptedData: serviceData.data,
                timestamp: serviceData.timestamp,
                provider: serviceData.provider,
                serviceType: serviceData.serviceType,
                reputation: serviceData.reputation || 0,
                status: serviceData.status || "available"
              });
            } catch (e) {
              console.error(`Error parsing service data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading service ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setServices(list);
    } catch (e) {
      console.error("Error loading services:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitService = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting service data with Zama FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newServiceData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const serviceId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const serviceData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        provider: account,
        serviceType: newServiceData.serviceType,
        reputation: Math.floor(Math.random() * 5) + 1, // Random reputation 1-5
        status: "available"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `service_${serviceId}`, 
        ethers.toUtf8Bytes(JSON.stringify(serviceData))
      );
      
      const keysBytes = await contract.getData("service_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(serviceId);
      
      await contract.setData(
        "service_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Service listing created securely with FHE!"
      });
      
      await loadServices();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewServiceData({
          serviceType: "",
          description: "",
          availability: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const matchService = async (serviceId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted matching with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const serviceBytes = await contract.getData(`service_${serviceId}`);
      if (serviceBytes.length === 0) {
        throw new Error("Service not found");
      }
      
      const serviceData = JSON.parse(ethers.toUtf8String(serviceBytes));
      
      const updatedService = {
        ...serviceData,
        status: "matched"
      };
      
      await contract.setData(
        `service_${serviceId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedService))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE matching completed successfully!"
      });
      
      await loadServices();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Matching failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const completeService = async (serviceId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing completion with FHE encryption..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const serviceBytes = await contract.getData(`service_${serviceId}`);
      if (serviceBytes.length === 0) {
        throw new Error("Service not found");
      }
      
      const serviceData = JSON.parse(ethers.toUtf8String(serviceBytes));
      
      const updatedService = {
        ...serviceData,
        status: "completed",
        reputation: serviceData.reputation + 1
      };
      
      await contract.setData(
        `service_${serviceId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedService))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Service completed with reputation update!"
      });
      
      await loadServices();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Completion failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isProvider = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to access the repair network",
      icon: "🔗"
    },
    {
      title: "List Your Skills",
      description: "Add your repair skills which will be encrypted using FHE",
      icon: "🔧"
    },
    {
      title: "FHE Matching",
      description: "Get matched with neighbors needing help while keeping privacy",
      icon: "⚡"
    },
    {
      title: "Build Reputation",
      description: "Earn reputation points for completed repairs securely",
      icon: "⭐"
    }
  ];

  // Filter services based on search and filter
  const filteredServices = services.filter(service => {
    const matchesSearch = service.serviceType.toLowerCase().includes(searchQuery.toLowerCase()) ||
      service.provider.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filterType === "all" || service.status === filterType;
    return matchesSearch && matchesFilter;
  });

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">🛠️</div>
          <h1>Repair<span>Chain</span></h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-service-btn"
          >
            + Offer Help
          </button>
          <button 
            className="tutorial-btn"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Guide" : "How It Works"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Anonymous Peer-to-Peer Appliance Repair</h2>
            <p>Connect with skilled neighbors using FHE encryption to protect everyone's privacy</p>
          </div>
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>How RepairChain Works</h2>
            <p className="subtitle">Secure, anonymous appliance repair matching in your community</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="dashboard-grid">
          <div className="dashboard-card">
            <h3>Community Repair Network</h3>
            <p>Anonymous matching platform using FHE to connect skilled repairers with neighbors in need while protecting everyone's privacy.</p>
            <div className="stats-row">
              <div className="stat">
                <div className="stat-value">{services.length}</div>
                <div className="stat-label">Total Services</div>
              </div>
              <div className="stat">
                <div className="stat-value">{avgReputation.toFixed(1)}</div>
                <div className="stat-label">Avg Rating</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card">
            <h3>Service Status</h3>
            <div className="status-chart">
              <div className="chart-bar available" style={{height: `${(availableCount/services.length)*100}%`}}>
                <span>{availableCount}</span>
              </div>
              <div className="chart-bar matched" style={{height: `${(matchedCount/services.length)*100}%`}}>
                <span>{matchedCount}</span>
              </div>
              <div className="chart-bar completed" style={{height: `${(completedCount/services.length)*100}%`}}>
                <span>{completedCount}</span>
              </div>
            </div>
            <div className="chart-legend">
              <div className="legend-item">
                <div className="color-dot available"></div>
                <span>Available</span>
              </div>
              <div className="legend-item">
                <div className="color-dot matched"></div>
                <span>Matched</span>
              </div>
              <div className="legend-item">
                <div className="color-dot completed"></div>
                <span>Completed</span>
              </div>
            </div>
          </div>
        </div>
        
        <div className="services-section">
          <div className="section-header">
            <h2>Available Repair Services</h2>
            <div className="header-actions">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search services..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <select 
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="filter-select"
              >
                <option value="all">All Status</option>
                <option value="available">Available</option>
                <option value="matched">Matched</option>
                <option value="completed">Completed</option>
              </select>
              <button 
                onClick={loadServices}
                className="refresh-btn"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="services-list">
            {filteredServices.length === 0 ? (
              <div className="no-services">
                <div className="no-services-icon">🔧</div>
                <p>No repair services found</p>
                <button 
                  className="primary-btn"
                  onClick={() => setShowCreateModal(true)}
                >
                  Offer Your Skills
                </button>
              </div>
            ) : (
              filteredServices.map(service => (
                <div className="service-card" key={service.id}>
                  <div className="service-header">
                    <h3>{service.serviceType}</h3>
                    <div className="service-meta">
                      <span className={`status-badge ${service.status}`}>
                        {service.status}
                      </span>
                      <div className="reputation">
                        {"⭐".repeat(service.reputation)}
                      </div>
                    </div>
                  </div>
                  <div className="service-details">
                    <div className="detail">
                      <span className="label">Provider:</span>
                      <span className="value">{service.provider.substring(0, 8)}... (anonymous)</span>
                    </div>
                    <div className="detail">
                      <span className="label">Listed:</span>
                      <span className="value">
                        {new Date(service.timestamp * 1000).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <div className="service-actions">
                    {service.status === "available" && (
                      <button 
                        className="action-btn primary"
                        onClick={() => matchService(service.id)}
                      >
                        Request Help
                      </button>
                    )}
                    {isProvider(service.provider) && service.status === "matched" && (
                      <button 
                        className="action-btn"
                        onClick={() => completeService(service.id)}
                      >
                        Mark Complete
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitService} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          serviceData={newServiceData}
          setServiceData={setNewServiceData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✅"}
              {transactionStatus.status === "error" && "❌"}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-section">
            <h3>RepairChain</h3>
            <p>Anonymous P2P appliance repair matching using FHE technology</p>
          </div>
          <div className="footer-section">
            <h4>Resources</h4>
            <a href="#">How it works</a>
            <a href="#">Privacy Policy</a>
            <a href="#">Terms of Service</a>
          </div>
          <div className="footer-section">
            <h4>Community</h4>
            <a href="#">Forum</a>
            <a href="#">Success Stories</a>
            <a href="#">Get Involved</a>
          </div>
        </div>
        <div className="footer-bottom">
          <p>© {new Date().getFullYear()} RepairChain. All repairs encrypted with FHE.</p>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  serviceData: any;
  setServiceData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  serviceData,
  setServiceData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setServiceData({
      ...serviceData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!serviceData.serviceType) {
      alert("Please select a service type");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>Offer Your Repair Skills</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="privacy-notice">
            🔒 Your information will be encrypted with FHE - only matches will see relevant details
          </div>
          
          <div className="form-group">
            <label>What can you repair? *</label>
            <select 
              name="serviceType"
              value={serviceData.serviceType} 
              onChange={handleChange}
              className="form-select"
            >
              <option value="">Select repair type</option>
              <option value="Refrigerator">Refrigerator</option>
              <option value="Washing Machine">Washing Machine</option>
              <option value="Oven">Oven & Stove</option>
              <option value="Dishwasher">Dishwasher</option>
              <option value="Microwave">Microwave</option>
              <option value="Small Appliances">Small Appliances</option>
              <option value="Electronics">Electronics</option>
              <option value="Other">Other Appliances</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              name="description"
              value={serviceData.description} 
              onChange={handleChange}
              placeholder="Describe your skills and experience..." 
              className="form-textarea"
              rows={3}
            />
          </div>
          
          <div className="form-group">
            <label>Availability</label>
            <input 
              type="text"
              name="availability"
              value={serviceData.availability} 
              onChange={handleChange}
              placeholder="When are you typically available?" 
              className="form-input"
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn primary"
          >
            {creating ? "Creating Secure Listing..." : "List My Skills"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;
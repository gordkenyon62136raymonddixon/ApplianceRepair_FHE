// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool, euint64 } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract ApplianceRepairFHE is SepoliaConfig {
    struct EncryptedRepairRequest {
        uint256 id;
        address requester;
        euint32 encryptedApplianceType;
        euint32 encryptedIssueDescription;
        euint32 encryptedUrgencyLevel;
        uint256 timestamp;
    }

    struct EncryptedRepairerProfile {
        uint256 id;
        address repairer;
        euint32 encryptedSkills;
        euint32 encryptedAvailability;
        euint32 encryptedReputationScore;
        uint256 timestamp;
    }

    struct RepairMatch {
        uint256 requestId;
        uint256 repairerId;
        euint32 encryptedMatchScore;
        bool isRevealed;
    }

    uint256 public requestCount;
    uint256 public repairerCount;
    mapping(uint256 => EncryptedRepairRequest) public repairRequests;
    mapping(uint256 => EncryptedRepairerProfile) public repairerProfiles;
    mapping(uint256 => RepairMatch) public repairMatches;
    
    mapping(uint256 => uint256) private requestToMatch;
    mapping(address => bool) public communityMembers;

    event RequestSubmitted(uint256 indexed id, address indexed requester);
    event RepairerRegistered(uint256 indexed id, address indexed repairer);
    event MatchingRequested(address indexed requester);
    event MatchCompleted(uint256 indexed requestId, uint256 indexed repairerId);
    event MatchRevealed(uint256 indexed requestId);

    modifier onlyCommunityMember() {
        require(communityMembers[msg.sender], "Not community member");
        _;
    }

    constructor() {
        // Initialize with some community members
        communityMembers[msg.sender] = true;
    }

    /// @notice Join the repair community
    function joinCommunity() public {
        communityMembers[msg.sender] = true;
    }

    /// @notice Submit encrypted repair request
    function submitRepairRequest(
        euint32 applianceType,
        euint32 issueDescription,
        euint32 urgencyLevel
    ) public onlyCommunityMember {
        requestCount++;
        repairRequests[requestCount] = EncryptedRepairRequest({
            id: requestCount,
            requester: msg.sender,
            encryptedApplianceType: applianceType,
            encryptedIssueDescription: issueDescription,
            encryptedUrgencyLevel: urgencyLevel,
            timestamp: block.timestamp
        });

        emit RequestSubmitted(requestCount, msg.sender);
    }

    /// @notice Register as a repairer
    function registerAsRepairer(
        euint32 skills,
        euint32 availability,
        euint32 initialReputation
    ) public onlyCommunityMember {
        repairerCount++;
        repairerProfiles[repairerCount] = EncryptedRepairerProfile({
            id: repairerCount,
            repairer: msg.sender,
            encryptedSkills: skills,
            encryptedAvailability: availability,
            encryptedReputationScore: initialReputation,
            timestamp: block.timestamp
        });

        emit RepairerRegistered(repairerCount, msg.sender);
    }

    /// @notice Request repairer matching
    function requestRepairerMatching(uint256 requestId) public onlyCommunityMember {
        require(repairRequests[requestId].requester == msg.sender, "Not request owner");
        
        bytes32[] memory ciphertexts = new bytes32[](repairerCount * 3 + 3);
        
        // Add request data
        ciphertexts[0] = FHE.toBytes32(repairRequests[requestId].encryptedApplianceType);
        ciphertexts[1] = FHE.toBytes32(repairRequests[requestId].encryptedIssueDescription);
        ciphertexts[2] = FHE.toBytes32(repairRequests[requestId].encryptedUrgencyLevel);
        
        // Add repairer data
        uint counter = 3;
        for (uint i = 1; i <= repairerCount; i++) {
            ciphertexts[counter++] = FHE.toBytes32(repairerProfiles[i].encryptedSkills);
            ciphertexts[counter++] = FHE.toBytes32(repairerProfiles[i].encryptedAvailability);
            ciphertexts[counter++] = FHE.toBytes32(repairerProfiles[i].encryptedReputationScore);
        }

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.findBestMatch.selector);
        requestToMatch[reqId] = requestId;

        emit MatchingRequested(msg.sender);
    }

    /// @notice Find best repairer match
    function findBestMatch(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 reqId = requestToMatch[requestId];
        require(reqId != 0, "Invalid request");

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint32[] memory values = abi.decode(cleartexts, (uint32[]));
        
        // Extract request data
        uint32 applianceType = values[0];
        uint32 issueDescription = values[1];
        uint32 urgencyLevel = values[2];
        
        // Find best matching repairer (simplified)
        uint256 bestMatchId = 0;
        uint32 bestScore = 0;
        
        for (uint i = 1; i <= repairerCount; i++) {
            uint32 skills = values[i*3];
            uint32 availability = values[i*3+1];
            uint32 reputation = values[i*3+2];
            
            // Simplified matching algorithm
            uint32 score = (skills * 40 + availability * 30 + reputation * 30) / 100;
            
            if (score > bestScore) {
                bestScore = score;
                bestMatchId = i;
            }
        }

        if (bestMatchId > 0) {
            repairMatches[requestId] = RepairMatch({
                requestId: requestId,
                repairerId: bestMatchId,
                encryptedMatchScore: FHE.asEuint32(bestScore),
                isRevealed: false
            });

            emit MatchCompleted(requestId, bestMatchId);
        }
    }

    /// @notice Reveal repair match
    function revealRepairMatch(uint256 requestId) public onlyCommunityMember {
        RepairMatch storage match = repairMatches[requestId];
        require(!match.isRevealed, "Already revealed");
        require(repairRequests[requestId].requester == msg.sender, "Not request owner");

        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(match.encryptedMatchScore);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.finalizeReveal.selector);
        requestToMatch[reqId] = requestId;
    }

    /// @notice Finalize match reveal
    function finalizeReveal(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 reqId = requestToMatch[requestId];
        require(reqId != 0, "Invalid request");

        FHE.checkSignatures(requestId, cleartexts, proof);

        repairMatches[requestId].isRevealed = true;
        emit MatchRevealed(requestId);
    }

    /// @notice Get repair request count
    function getRequestCount() public view returns (uint256) {
        return requestCount;
    }

    /// @notice Get repairer count
    function getRepairerCount() public view returns (uint256) {
        return repairerCount;
    }

    /// @notice Check if match exists for a request
    function hasMatch(uint256 requestId) public view returns (bool) {
        return repairMatches[requestId].requestId != 0;
    }
}